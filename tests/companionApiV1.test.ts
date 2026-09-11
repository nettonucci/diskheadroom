import { describe, expect, it } from 'vitest'
import fixtures from './fixtures/companion-api-v1.json'
import {
  COMPANION_PROTOCOL_V1,
  CompanionMessageSchema,
  DeviceCapabilitiesSchema,
  DiskSummarySchema,
  ErrorMessageSchema,
  ForecastSummarySchema,
  PermissionSummarySchema,
  ProtocolErrorSchema,
  SanitizedScanItemSchema,
  ScanProgressEventMessageSchema,
  ScanProgressSchema,
  ScanRequestSchema,
  ScanResultEventMessageSchema,
  ScanResultSummarySchema,
  ScanStartRequestMessageSchema,
  StatusGetRequestMessageSchema,
  StatusGetResponseMessageSchema,
  negotiateProtocolVersion
} from '../src/shared/companionApiV1'

describe('Companion API v1 compatibility', () => {
  it('validates every canonical fixture from the mobile contract', () => {
    expect(fixtures.protocolVersion).toBe(COMPANION_PROTOCOL_V1)

    for (const message of fixtures.messages) {
      expect(CompanionMessageSchema.safeParse(message)).toMatchObject({ success: true })
    }
  })

  it('validates every public payload schema used by the Mac', () => {
    const status = StatusGetResponseMessageSchema.parse(fixtures.messages[5])
    const scanRequest = ScanStartRequestMessageSchema.parse(fixtures.messages[6])
    const progress = ScanProgressEventMessageSchema.parse(fixtures.messages[8])
    const result = ScanResultEventMessageSchema.parse(fixtures.messages[9])
    const protocolError = ErrorMessageSchema.parse(fixtures.messages[12])

    expect(DeviceCapabilitiesSchema.parse(status.payload.capabilities)).toBeDefined()
    expect(DiskSummarySchema.parse(status.payload.disk)).toBeDefined()
    expect(PermissionSummarySchema.parse(status.payload.permissions)).toBeDefined()
    expect(ForecastSummarySchema.parse(status.payload.forecast)).toBeDefined()
    expect(ScanRequestSchema.parse(scanRequest.payload)).toBeDefined()
    expect(ScanProgressSchema.parse(progress.payload)).toBeDefined()
    expect(ScanResultSummarySchema.parse(result.payload)).toBeDefined()
    expect(SanitizedScanItemSchema.parse(result.payload.items[0])).toBeDefined()
    expect(ProtocolErrorSchema.parse(protocolError.error)).toBeDefined()
  })

  it('negotiates v1 and fails closed with actionable guidance', () => {
    expect(negotiateProtocolVersion(['2.0', '1.0'])).toEqual({
      ok: true,
      version: '1.0'
    })
    expect(negotiateProtocolVersion(['2.0'])).toEqual({
      ok: false,
      error: {
        code: 'incompatible-version',
        message: 'Versão incompatível. Atualize o Disk Headroom no celular e no Mac.',
        retryable: false
      }
    })
  })

  it.each([
    'unauthorized',
    'incompatible-version',
    'scan-in-progress',
    'mac-locked',
    'limited-permissions'
  ] as const)('keeps stable protocol error %s', (code) => {
    expect(
      ProtocolErrorSchema.safeParse({
        code,
        message: 'Não foi possível concluir a solicitação.',
        retryable: false
      }).success
    ).toBe(true)
  })

  it('rejects messages without replay metadata', () => {
    const { nonce: _nonce, ...message } = StatusGetRequestMessageSchema.parse(fixtures.messages[4])
    expect(CompanionMessageSchema.safeParse(message).success).toBe(false)
  })

  it.each(['path', 'license', 'neverTouchPaths', 'settings'])(
    'rejects forbidden field %s from a sanitized result',
    (field) => {
      const message = ScanResultEventMessageSchema.parse(fixtures.messages[9])
      const [item] = message.payload.items
      Object.assign(item!, {
        [field]: field === 'path' ? '/Users/netto/secret.mov' : 'secret'
      })

      expect(CompanionMessageSchema.safeParse(message).success).toBe(false)
    }
  )

  it('does not expose a remote cleanup route', () => {
    const message = {
      ...StatusGetRequestMessageSchema.parse(fixtures.messages[4]),
      route: 'clean.start'
    }

    expect(CompanionMessageSchema.safeParse(message).success).toBe(false)
  })
})
