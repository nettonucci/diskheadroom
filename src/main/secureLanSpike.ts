import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { hostname } from 'node:os'
import { BrowserWindow } from 'electron'
import Bonjour from 'bonjour-service'
import QRCode from 'qrcode'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import {
  ClientHelloSchema,
  SECURE_LAN_SERVICE_TYPE,
  assertFreshTimestamp,
  createEphemeralKeyPair,
  decodeBase64Url,
  decryptFrame,
  deriveSessionKeys,
  encodeBase64Url,
  encodePairingDescriptor,
  encryptFrame,
  equalBytes,
  type PairingDescriptor
} from '../shared/secureLan'

const PAIRING_LIFETIME_MS = 2 * 60_000
export const SECURE_LAN_LISTEN_HOST = '::'

export interface PairingSession {
  descriptor: PairingDescriptor
  secretKey: Uint8Array
  token: Uint8Array
  used: boolean
}

export interface SecureLanSpikeController {
  port: number
  stop: () => Promise<void>
}

export async function startSecureLanSpike(): Promise<SecureLanSpikeController> {
  const webSocketServer = new WebSocketServer({
    // A hostname .local pode resolver primeiro para IPv6 no iOS. O wildcard
    // IPv6 do macOS também aceita IPv4 mapeado, mantendo o listener dual-stack.
    host: SECURE_LAN_LISTEN_HOST,
    maxPayload: 1024 * 1024,
    path: '/spike',
    perMessageDeflate: false,
    port: 0,
  })
  await waitForListening(webSocketServer)

  const address = webSocketServer.address()
  if (!address || typeof address === 'string') {
    throw new Error('Não foi possível determinar a porta do spike LAN.')
  }

  const port = address.port
  const discoveryId = randomUUID()
  const bonjour = new Bonjour()
  const service = bonjour.publish({
    name: `Disk Headroom ${discoveryId.slice(0, 8)}`,
    type: SECURE_LAN_SERVICE_TYPE,
    protocol: 'tcp',
    port,
    txt: {
      instance: discoveryId,
      version: '1',
      security: 'x25519-xchacha20poly1305'
    }
  })
  service.start()

  let pairingWindow: BrowserWindow | null = null
  let session = createPairingSession(port)
  const showCurrentPairing = async () => {
    pairingWindow = await showPairingWindow(session.descriptor, pairingWindow)
  }
  await showCurrentPairing()

  const rotationTimer = setInterval(() => {
    if (session.used || Date.parse(session.descriptor.expiresAt) <= Date.now()) {
      session = createPairingSession(port)
      void showCurrentPairing()
    }
  }, 5_000)

  webSocketServer.on('connection', (socket) => {
    const handshakeTimeout = setTimeout(
      () => socket.close(1008, 'handshake timeout'),
      8_000
    )
    socket.once('close', () => clearTimeout(handshakeTimeout))
    socket.once('message', (data, isBinary) => {
      clearTimeout(handshakeTimeout)
      handleClientHello(socket, data, isBinary, session)
        .then(async (accepted) => {
          if (!accepted) return
          if (pairingWindow && !pairingWindow.isDestroyed()) {
            await showSuccess(pairingWindow)
          }
        })
        .catch(() => socket.close(1008, 'invalid handshake'))
    })
  })

  return {
    port,
    stop: async () => {
      clearInterval(rotationTimer)
      service.stop()
      bonjour.destroy()
      if (pairingWindow && !pairingWindow.isDestroyed()) pairingWindow.close()
      await closeWebSocketServer(webSocketServer)
    }
  }
}

export function createPairingSession(port: number): PairingSession {
  const keyPair = createEphemeralKeyPair(
    (length) => new Uint8Array(randomBytes(length))
  )
  const token = new Uint8Array(randomBytes(32))
  const host = resolveLocalMdnsHostname()
  const descriptor: PairingDescriptor = {
    version: 1,
    sessionId: randomUUID(),
    host,
    port,
    serverPublicKey: encodeBase64Url(keyPair.publicKey),
    pairingToken: encodeBase64Url(token),
    expiresAt: new Date(Date.now() + PAIRING_LIFETIME_MS).toISOString()
  }

  return { descriptor, secretKey: keyPair.secretKey, token, used: false }
}

export function resolveLocalMdnsHostname(
  readLocalHostName: () => string = () =>
    execFileSync('/usr/sbin/scutil', ['--get', 'LocalHostName'], {
      encoding: 'utf8'
    }),
  systemHostname: string = hostname()
): string {
  try {
    return formatLocalMdnsHostname(readLocalHostName())
  } catch {
    return formatLocalMdnsHostname(systemHostname)
  }
}

function formatLocalMdnsHostname(value: string): string {
  const label = value.trim().replace(/\.$/, '').split('.')[0]
  if (!label || !/^[a-zA-Z0-9-]{1,63}$/.test(label)) {
    throw new Error('O hostname local do Mac é inválido.')
  }

  return `${label}.local`
}

export async function handleClientHello(
  socket: WebSocket,
  data: RawData,
  isBinary: boolean,
  session: PairingSession
): Promise<boolean> {
  if (isBinary || session.used || Date.parse(session.descriptor.expiresAt) <= Date.now()) {
    socket.close(1008, 'pairing unavailable')
    return false
  }

  const hello = ClientHelloSchema.parse(JSON.parse(data.toString()))
  if (hello.sessionId !== session.descriptor.sessionId) {
    socket.close(1008, 'invalid session')
    return false
  }

  const keys = deriveSessionKeys(
    'responder',
    session.secretKey,
    decodeBase64Url(hello.clientPublicKey),
    session.token,
    session.descriptor.sessionId
  )
  const { message } = decryptFrame(
    keys.receive,
    session.descriptor.sessionId,
    0,
    hello.frame
  )
  assertFreshTimestamp(message.timestamp)

  if (
    message.type !== 'pair.prove' ||
    !message.pairingToken ||
    !equalBytes(decodeBase64Url(message.pairingToken), session.token)
  ) {
    socket.close(1008, 'unauthorized')
    return false
  }

  session.used = true
  socket.send(
    JSON.stringify(
      encryptFrame(
        keys.transmit,
        session.descriptor.sessionId,
        1,
        {
          type: 'pair.accepted',
          requestId: message.requestId,
          timestamp: new Date().toISOString(),
          platform: 'macos'
        },
        (length) => new Uint8Array(randomBytes(length))
      )
    )
  )
  return true
}

async function showPairingWindow(
  descriptor: PairingDescriptor,
  existingWindow: BrowserWindow | null
): Promise<BrowserWindow> {
  const value = encodePairingDescriptor(descriptor)
  const qrDataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 300
  })
  const window =
    existingWindow && !existingWindow.isDestroyed()
      ? existingWindow
      : new BrowserWindow({
          width: 440,
          height: 610,
          resizable: false,
          title: 'Disk Headroom — Spike LAN',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        })
  await window.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(pairingHtml(qrDataUrl, value, descriptor.expiresAt))}`
  )
  window.show()
  return window
}

async function showSuccess(window: BrowserWindow): Promise<void> {
  await window.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(successHtml())}`
  )
}

function pairingHtml(qrDataUrl: string, descriptor: string, expiresAt: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
    <title>Spike LAN</title>
    <style>
      body { background:#f5f5f7; color:#191a23; font:16px -apple-system,sans-serif; margin:0; padding:28px; text-align:center }
      img { background:#fff; border:2px solid #191a23; border-radius:20px; display:block; margin:20px auto; width:300px }
      h1 { margin:0; font-size:25px } p { line-height:1.45 }
      textarea { box-sizing:border-box; height:76px; resize:none; width:100%; border:2px solid #191a23; border-radius:10px; padding:8px; font-size:11px }
      .pill { background:#93ae8f; border:2px solid #191a23; border-radius:99px; display:inline-block; padding:6px 12px; font-weight:700 }
    </style>
  </head>
  <body>
    <div class="pill">Somente desenvolvimento</div>
    <h1>Parear diagnóstico LAN</h1>
    <p>Leia o QR no app mobile. Expira às ${escapeHtml(new Date(expiresAt).toLocaleTimeString('pt-BR'))}.</p>
    <img alt="QR de pareamento efêmero" src="${qrDataUrl}">
    <textarea aria-label="Descriptor manual" readonly>${escapeHtml(descriptor)}</textarea>
  </body>
</html>`
}

function successHtml(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>Canal validado</title>
    <style>
      body { align-items:center; background:#93ae8f; color:#191a23; display:flex; font:18px -apple-system,sans-serif; height:100vh; justify-content:center; margin:0; text-align:center }
      main { max-width:320px } h1 { font-size:30px }
    </style>
  </head>
  <body><main><h1>Canal validado</h1><p>Handshake autenticado e criptografado concluído. O token foi invalidado.</p></main></body>
</html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function waitForListening(server: WebSocketServer): Promise<void> {
  if (server.address()) return
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
}

async function closeWebSocketServer(server: WebSocketServer): Promise<void> {
  for (const client of server.clients) client.close()
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}
