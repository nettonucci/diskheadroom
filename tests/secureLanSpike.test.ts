import { randomBytes, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { WebSocket } from 'ws'
import {
  createPairingSession,
  handleClientHello,
  resolveLocalMdnsHostname
} from '../src/main/secureLanSpike'
import {
  createEphemeralKeyPair,
  decodeBase64Url,
  decryptFrame,
  deriveSessionKeys,
  encodeBase64Url,
  encryptFrame
} from '../src/shared/secureLan'

describe('secure LAN spike server', () => {
  it('uses the macOS LocalHostName for the pairing descriptor', () => {
    expect(
      resolveLocalMdnsHostname(() => 'Nettos-MacBook-Pro\n', 'macbookpro.lan')
    ).toBe('Nettos-MacBook-Pro.local')
  })

  it('removes the DNS suffix when LocalHostName is unavailable', () => {
    expect(
      resolveLocalMdnsHostname(
        () => {
          throw new Error('scutil unavailable')
        },
        'macbookpro.lan'
      )
    ).toBe('macbookpro.local')
  })

  it('accepts one authenticated proof and returns an encrypted response', async () => {
    const session = createPairingSession(43119)
    const client = createEphemeralKeyPair(
      (length) => new Uint8Array(randomBytes(length))
    )
    const token = decodeBase64Url(session.descriptor.pairingToken)
    const keys = deriveSessionKeys(
      'initiator',
      client.secretKey,
      decodeBase64Url(session.descriptor.serverPublicKey),
      token,
      session.descriptor.sessionId
    )
    const requestId = randomUUID()
    const frame = encryptFrame(
      keys.transmit,
      session.descriptor.sessionId,
      1,
      {
        type: 'pair.prove',
        requestId,
        timestamp: new Date().toISOString(),
        pairingToken: session.descriptor.pairingToken,
        platform: 'ios'
      },
      (length) => new Uint8Array(randomBytes(length))
    )
    const socket = new FakeSocket()

    await expect(
      handleClientHello(
        socket as unknown as WebSocket,
        Buffer.from(
          JSON.stringify({
            version: 1,
            sessionId: session.descriptor.sessionId,
            clientPublicKey: encodeBase64Url(client.publicKey),
            frame
          })
        ),
        false,
        session
      )
    ).resolves.toBe(true)

    expect(session.used).toBe(true)
    expect(socket.sent).toHaveLength(1)
    expect(
      decryptFrame(
        keys.receive,
        session.descriptor.sessionId,
        0,
        JSON.parse(socket.sent[0]!)
      ).message
    ).toMatchObject({
      type: 'pair.accepted',
      requestId,
      platform: 'macos'
    })
  })

  it('rejects replay after the one-time token is consumed', async () => {
    const session = createPairingSession(43119)
    session.used = true
    const socket = new FakeSocket()

    await expect(
      handleClientHello(
        socket as unknown as WebSocket,
        Buffer.from('{}'),
        false,
        session
      )
    ).resolves.toBe(false)
    expect(socket.closed).toEqual({ code: 1008, reason: 'pairing unavailable' })
  })

  it('rejects binary and expired handshakes before parsing', async () => {
    const session = createPairingSession(43119)
    session.descriptor.expiresAt = new Date(Date.now() - 1).toISOString()
    const socket = new FakeSocket()

    await expect(
      handleClientHello(
        socket as unknown as WebSocket,
        Buffer.from([1, 2, 3]),
        true,
        session
      )
    ).resolves.toBe(false)
    expect(socket.sent).toEqual([])
  })
})

class FakeSocket {
  sent: string[] = []
  closed: { code: number; reason: string } | null = null

  send(value: string): void {
    this.sent.push(value)
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason }
  }
}
