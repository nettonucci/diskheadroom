import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { z } from 'zod'

export const SECURE_LAN_VERSION = 1 as const
export const SECURE_LAN_SERVICE_TYPE = 'diskheadroom'
export const SECURE_LAN_MAX_CLOCK_SKEW_MS = 30_000

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const encodedBytesSchema = z.string().regex(/^[A-Za-z0-9_-]+$/)

export const PairingDescriptorSchema = z
  .object({
    version: z.literal(SECURE_LAN_VERSION),
    sessionId: z.string().uuid(),
    host: z.string().trim().min(1).max(253).regex(/^[^\s/:]+$/),
    port: z.number().int().min(1).max(65_535),
    serverPublicKey: encodedBytesSchema,
    pairingToken: encodedBytesSchema,
    expiresAt: z.string().datetime({ offset: true })
  })
  .strict()

export const EncryptedFrameSchema = z
  .object({
    version: z.literal(SECURE_LAN_VERSION),
    sessionId: z.string().uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    nonce: encodedBytesSchema,
    ciphertext: encodedBytesSchema
  })
  .strict()

export const DiagnosticMessageSchema = z
  .object({
    type: z.enum(['pair.prove', 'pair.accepted']),
    requestId: z.string().uuid(),
    timestamp: z.string().datetime({ offset: true }),
    pairingToken: encodedBytesSchema.optional(),
    platform: z.enum(['ios', 'android', 'macos']).optional()
  })
  .strict()

export const ClientHelloSchema = z
  .object({
    version: z.literal(SECURE_LAN_VERSION),
    sessionId: z.string().uuid(),
    clientPublicKey: encodedBytesSchema,
    frame: EncryptedFrameSchema
  })
  .strict()

export type PairingDescriptor = z.infer<typeof PairingDescriptorSchema>
export type EncryptedFrame = z.infer<typeof EncryptedFrameSchema>
export type DiagnosticMessage = z.infer<typeof DiagnosticMessageSchema>
export type ClientHello = z.infer<typeof ClientHelloSchema>

export interface EphemeralKeyPair {
  secretKey: Uint8Array
  publicKey: Uint8Array
}

export interface SessionKeys {
  transmit: Uint8Array
  receive: Uint8Array
}

export type RandomBytes = (length: number) => Uint8Array

export function createEphemeralKeyPair(randomBytes: RandomBytes): EphemeralKeyPair {
  const secretKey = randomBytes(32)
  return {
    secretKey,
    publicKey: x25519.getPublicKey(secretKey)
  }
}

export function deriveSessionKeys(
  role: 'initiator' | 'responder',
  secretKey: Uint8Array,
  peerPublicKey: Uint8Array,
  pairingToken: Uint8Array,
  sessionId: string
): SessionKeys {
  assertLength(secretKey, 32, 'Chave privada')
  assertLength(peerPublicKey, 32, 'Chave pública')
  assertLength(pairingToken, 32, 'Token de pareamento')

  const sharedSecret = x25519.getSharedSecret(secretKey, peerPublicKey)
  const material = hkdf(
    sha256,
    sharedSecret,
    pairingToken,
    textEncoder.encode(`diskheadroom-secure-lan-v1:${sessionId}`),
    64
  )
  const initiatorToResponder = material.slice(0, 32)
  const responderToInitiator = material.slice(32, 64)

  return role === 'initiator'
    ? {
        transmit: initiatorToResponder,
        receive: responderToInitiator
      }
    : {
        transmit: responderToInitiator,
        receive: initiatorToResponder
      }
}

export function encryptFrame(
  key: Uint8Array,
  sessionId: string,
  sequence: number,
  payload: DiagnosticMessage,
  randomBytes: RandomBytes
): EncryptedFrame {
  assertLength(key, 32, 'Chave de sessão')
  const parsedPayload = DiagnosticMessageSchema.parse(payload)
  const nonce = randomBytes(24)
  const aad = frameAad(sessionId, sequence)
  const ciphertext = xchacha20poly1305(key, nonce, aad).encrypt(
    textEncoder.encode(JSON.stringify(parsedPayload))
  )

  return {
    version: SECURE_LAN_VERSION,
    sessionId,
    sequence,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(ciphertext)
  }
}

export function decryptFrame(
  key: Uint8Array,
  expectedSessionId: string,
  lastSequence: number,
  input: unknown
): { message: DiagnosticMessage; sequence: number } {
  assertLength(key, 32, 'Chave de sessão')
  const frame = EncryptedFrameSchema.parse(input)

  if (frame.sessionId !== expectedSessionId) {
    throw new Error('Sessão de pareamento inválida.')
  }
  if (frame.sequence !== lastSequence + 1) {
    throw new Error('Mensagem repetida ou fora de ordem.')
  }

  const nonce = decodeBase64Url(frame.nonce)
  assertLength(nonce, 24, 'Nonce')
  const plaintext = xchacha20poly1305(
    key,
    nonce,
    frameAad(frame.sessionId, frame.sequence)
  ).decrypt(decodeBase64Url(frame.ciphertext))
  const message = DiagnosticMessageSchema.parse(JSON.parse(textDecoder.decode(plaintext)))

  return { message, sequence: frame.sequence }
}

export function assertFreshTimestamp(
  timestamp: string,
  nowMs = Date.now(),
  maxClockSkewMs = SECURE_LAN_MAX_CLOCK_SKEW_MS
): void {
  const timestampMs = Date.parse(timestamp)
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > maxClockSkewMs) {
    throw new Error('Timestamp fora da janela permitida.')
  }
}

export function encodePairingDescriptor(descriptor: PairingDescriptor): string {
  const parsed = PairingDescriptorSchema.parse(descriptor)
  const params = new URLSearchParams({
    version: String(parsed.version),
    sessionId: parsed.sessionId,
    host: parsed.host,
    port: String(parsed.port),
    serverPublicKey: parsed.serverPublicKey,
    pairingToken: parsed.pairingToken,
    expiresAt: parsed.expiresAt
  })

  return `diskheadroom://pair?${params.toString()}`
}

export function decodePairingDescriptor(value: string): PairingDescriptor {
  const url = new URL(value)
  if (url.protocol !== 'diskheadroom:' || url.hostname !== 'pair') {
    throw new Error('QR code de pareamento inválido.')
  }

  const descriptor = PairingDescriptorSchema.parse({
    version: Number(url.searchParams.get('version')),
    sessionId: url.searchParams.get('sessionId'),
    host: url.searchParams.get('host'),
    port: Number(url.searchParams.get('port')),
    serverPublicKey: url.searchParams.get('serverPublicKey'),
    pairingToken: url.searchParams.get('pairingToken'),
    expiresAt: url.searchParams.get('expiresAt')
  })
  assertLength(decodeBase64Url(descriptor.serverPublicKey), 32, 'Chave pública')
  assertLength(decodeBase64Url(descriptor.pairingToken), 32, 'Token de pareamento')

  if (Date.parse(descriptor.expiresAt) <= Date.now()) {
    throw new Error('Este QR code expirou. Gere outro no Mac.')
  }

  return descriptor
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/u, '')
}

export function decodeBase64Url(value: string): Uint8Array {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + padding)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index]! ^ right[index]!
  }
  return difference === 0
}

function frameAad(sessionId: string, sequence: number): Uint8Array {
  return textEncoder.encode(`${SECURE_LAN_VERSION}:${sessionId}:${sequence}`)
}

function assertLength(bytes: Uint8Array, length: number, label: string): void {
  if (bytes.length !== length) {
    throw new Error(`${label} deve conter ${length} bytes.`)
  }
}
