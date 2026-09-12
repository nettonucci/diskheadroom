import { describe, expect, it, vi } from 'vitest'
import {
  assertFreshTimestamp,
  createEphemeralKeyPair,
  decodeBase64Url,
  decodePairingDescriptor,
  decryptFrame,
  deriveSessionKeys,
  encodeBase64Url,
  encodePairingDescriptor,
  encryptFrame,
  equalBytes
} from '../src/shared/secureLan'

const sessionId = '77777777-7777-4777-8777-777777777777'
const requestId = '88888888-8888-4888-8888-888888888888'
const now = Date.parse('2026-09-11T20:00:00.000Z')

describe('secure LAN envelope compatibility', () => {
  const server = createEphemeralKeyPair(deterministicBytes(1))
  const client = createEphemeralKeyPair(deterministicBytes(33))
  const token = deterministicBytes(65)(32)
  const clientKeys = deriveSessionKeys(
    'initiator',
    client.secretKey,
    server.publicKey,
    token,
    sessionId
  )
  const serverKeys = deriveSessionKeys(
    'responder',
    server.secretKey,
    client.publicKey,
    token,
    sessionId
  )

  it('derives matching directional keys on both peers', () => {
    expect(clientKeys.transmit).toEqual(serverKeys.receive)
    expect(clientKeys.receive).toEqual(serverKeys.transmit)
    expect(clientKeys.transmit).not.toEqual(clientKeys.receive)
  })

  it('encrypts and authenticates the mobile pairing proof', () => {
    const frame = encryptFrame(
      clientKeys.transmit,
      sessionId,
      1,
      {
        type: 'pair.prove',
        requestId,
        timestamp: new Date(now).toISOString(),
        pairingToken: encodeBase64Url(token),
        platform: 'ios'
      },
      deterministicBytes(97)
    )

    expect(JSON.stringify(frame)).not.toContain(encodeBase64Url(token))
    expect(JSON.stringify(frame)).not.toContain(requestId)
    expect(JSON.stringify(frame)).not.toContain('pair.prove')
    expect(decryptFrame(serverKeys.receive, sessionId, 0, frame)).toMatchObject({
      message: { type: 'pair.prove', requestId },
      sequence: 1
    })
  })

  it('rejects replay, another session and tampered ciphertext', () => {
    const frame = encryptFrame(
      clientKeys.transmit,
      sessionId,
      1,
      {
        type: 'pair.prove',
        requestId,
        timestamp: new Date(now).toISOString(),
        pairingToken: encodeBase64Url(token)
      },
      deterministicBytes(121)
    )

    expect(() => decryptFrame(serverKeys.receive, sessionId, 1, frame)).toThrow(
      'Mensagem repetida'
    )
    expect(() => decryptFrame(serverKeys.receive, sessionId, -1, frame)).toThrow(
      'fora de ordem'
    )
    expect(() =>
      decryptFrame(
        serverKeys.receive,
        '99999999-9999-4999-8999-999999999999',
        0,
        frame
      )
    ).toThrow('Sessão de pareamento inválida')

    const ciphertext = decodeBase64Url(frame.ciphertext)
    ciphertext[0] ^= 1
    expect(() =>
      decryptFrame(serverKeys.receive, sessionId, 0, {
        ...frame,
        ciphertext: encodeBase64Url(ciphertext)
      })
    ).toThrow()
  })

  it('round-trips and expires the out-of-band descriptor', () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const descriptor = {
      version: 1 as const,
      sessionId,
      host: 'macbook-pro.local',
      port: 43119,
      serverPublicKey: encodeBase64Url(server.publicKey),
      pairingToken: encodeBase64Url(token),
      expiresAt: '2026-09-11T20:02:00.000Z'
    }
    expect(decodePairingDescriptor(encodePairingDescriptor(descriptor))).toEqual(descriptor)

    expect(() =>
      decodePairingDescriptor(
        encodePairingDescriptor({
          ...descriptor,
          expiresAt: '2026-09-11T19:59:59.000Z'
        })
      )
    ).toThrow('QR code expirou')
  })

  it('checks timestamps, base64url and byte equality', () => {
    expect(() => assertFreshTimestamp('2026-09-11T20:00:20.000Z', now)).not.toThrow()
    expect(() => assertFreshTimestamp('2026-09-11T20:01:00.000Z', now)).toThrow(
      'Timestamp fora'
    )

    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252])
    expect(decodeBase64Url(encodeBase64Url(bytes))).toEqual(bytes)
    expect(equalBytes(bytes, bytes.slice())).toBe(true)
    expect(equalBytes(bytes, new Uint8Array([0, 1]))).toBe(false)
  })
})

function deterministicBytes(offset: number) {
  return (length: number) =>
    Uint8Array.from({ length }, (_, index) => (offset + index) % 256)
}
