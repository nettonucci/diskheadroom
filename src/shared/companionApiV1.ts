import { z } from 'zod'

// Cópia compatível da fonte canônica do mobile em src/contracts/v1.ts.
// Mudanças devem manter as fixtures dos dois repositórios idênticas.
export const COMPANION_PROTOCOL_V1 = '1.0' as const
export const SUPPORTED_COMPANION_PROTOCOL_VERSIONS = [COMPANION_PROTOCOL_V1] as const

const bytesSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const countSchema = z.number().int().min(0).max(1_000_000_000)
const timestampSchema = z.string().datetime({ offset: true })
const identifierSchema = z.string().uuid()
const keyMaterialSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/)
const nonceSchema = z
  .string()
  .min(22)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/)
const safeDisplayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^\u0000-\u001f/\\]+$/)

export const ProtocolVersionSchema = z.literal(COMPANION_PROTOCOL_V1)
export const AdvertisedProtocolVersionSchema = z.string().regex(/^\d+\.\d+$/)

export const DeviceCapabilitiesSchema = z
  .object({
    supportedProtocolVersions: z.array(AdvertisedProtocolVersionSchema).min(1).max(10),
    canStartScan: z.boolean(),
    canReviewSanitizedResults: z.boolean(),
    remoteCleanup: z.literal(false),
    forecast: z.enum(['available', 'unavailable'])
  })
  .strict()

export const DiskSummarySchema = z
  .object({
    totalBytes: bytesSchema,
    usedBytes: bytesSchema,
    freeBytes: bytesSchema,
    updatedAt: timestampSchema
  })
  .strict()

export const PermissionStateSchema = z.enum(['granted', 'limited', 'denied', 'not-determined'])

export const PermissionSummarySchema = z
  .object({
    fullDiskAccess: PermissionStateSchema,
    libraryCaches: PermissionStateSchema,
    applications: PermissionStateSchema
  })
  .strict()

export const ForecastSummarySchema = z
  .object({
    status: z.enum(['unavailable', 'learning', 'ready']),
    daysToFull: z.number().int().min(0).max(36_500).nullable(),
    confidence: z.enum(['unavailable', 'low', 'medium', 'high']),
    updatedAt: timestampSchema.nullable()
  })
  .strict()

export const ScanCategorySchema = z.enum([
  'userCaches',
  'userLogs',
  'homebrewCache',
  'packageManagerCaches',
  'trash',
  'xcodeDerivedData',
  'iosDeviceSupport',
  'xcodeArchives',
  'unavailableSimulators',
  'outdatedSimulators',
  'coreSimulatorCaches',
  'dockerDesktop',
  'androidDevCaches',
  'idleUserFolders',
  'largeFiles',
  'downloadsReview',
  'duplicateFiles',
  'unusedApps'
])

export const ScanRequestSchema = z
  .object({
    categories: z.array(ScanCategorySchema).min(1).max(18)
  })
  .strict()

export const ScanProgressSchema = z
  .object({
    scanId: identifierSchema,
    phase: z.enum(['queued', 'discovering', 'measuring', 'classifying', 'finalizing']),
    percent: z.number().min(0).max(100),
    scannedItems: countSchema
  })
  .strict()

export const SanitizedScanItemSchema = z
  .object({
    id: identifierSchema,
    category: ScanCategorySchema,
    displayName: safeDisplayNameSchema,
    sizeBytes: bytesSchema,
    createdAt: timestampSchema.nullable(),
    modifiedAt: timestampSchema.nullable(),
    reviewOnMacRequired: z.literal(true)
  })
  .strict()

export const ScanResultSummarySchema = z
  .object({
    scanId: identifierSchema,
    status: z.enum(['completed', 'cancelled', 'failed']),
    itemCount: countSchema,
    reclaimableBytes: bytesSchema,
    limitedPermissions: z.boolean(),
    items: z.array(SanitizedScanItemSchema).max(5_000),
    generatedAt: timestampSchema,
    expiresAt: timestampSchema
  })
  .strict()

export const ProtocolErrorCodeSchema = z.enum([
  'unauthorized',
  'incompatible-version',
  'scan-in-progress',
  'mac-locked',
  'limited-permissions',
  'invalid-message'
])

export const ProtocolErrorSchema = z
  .object({
    code: ProtocolErrorCodeSchema,
    message: z.string().trim().min(1).max(240),
    retryable: z.boolean()
  })
  .strict()

export const CompanionRouteSchema = z.enum([
  'pair.start',
  'pair.complete',
  'status.get',
  'scan.start',
  'device.revoke'
])

export const CompanionEventSchema = z.enum(['scan.progress', 'scan.result'])

const metadataShape = {
  protocolVersion: ProtocolVersionSchema,
  requestId: identifierSchema,
  timestamp: timestampSchema,
  nonce: nonceSchema
}

const emptyPayloadSchema = z.object({}).strict()

export const PairStartRequestMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('request'),
    route: z.literal('pair.start'),
    payload: z
      .object({
        mobileDeviceId: identifierSchema,
        mobileDisplayName: safeDisplayNameSchema.max(80),
        mobilePublicKey: keyMaterialSchema,
        pairingToken: keyMaterialSchema,
        supportedProtocolVersions: z.array(AdvertisedProtocolVersionSchema).min(1).max(10)
      })
      .strict()
  })
  .strict()

export const PairStartResponseMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('response'),
    route: z.literal('pair.start'),
    payload: z
      .object({
        pairingSessionId: identifierSchema,
        macDeviceId: identifierSchema,
        macDisplayName: safeDisplayNameSchema.max(80),
        macPublicKey: keyMaterialSchema,
        challenge: keyMaterialSchema,
        negotiatedVersion: ProtocolVersionSchema,
        expiresAt: timestampSchema
      })
      .strict()
  })
  .strict()

export const PairCompleteRequestMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('request'),
    route: z.literal('pair.complete'),
    payload: z
      .object({
        pairingSessionId: identifierSchema,
        challengeSignature: keyMaterialSchema,
        negotiatedVersion: ProtocolVersionSchema
      })
      .strict()
  })
  .strict()

export const PairCompleteResponseMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('response'),
    route: z.literal('pair.complete'),
    payload: z
      .object({
        peerId: identifierSchema,
        pairedAt: timestampSchema
      })
      .strict()
  })
  .strict()

export const StatusGetRequestMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('request'),
    route: z.literal('status.get'),
    payload: emptyPayloadSchema
  })
  .strict()

export const StatusGetResponseMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('response'),
    route: z.literal('status.get'),
    payload: z
      .object({
        device: z
          .object({
            id: identifierSchema,
            displayName: safeDisplayNameSchema.max(80),
            appVersion: z.string().trim().min(1).max(40),
            locked: z.boolean()
          })
          .strict(),
        capabilities: DeviceCapabilitiesSchema,
        disk: DiskSummarySchema,
        permissions: PermissionSummarySchema,
        forecast: ForecastSummarySchema,
        activeScanId: identifierSchema.nullable()
      })
      .strict()
  })
  .strict()

export const ScanStartRequestMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('request'),
    route: z.literal('scan.start'),
    payload: ScanRequestSchema
  })
  .strict()

export const ScanStartResponseMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('response'),
    route: z.literal('scan.start'),
    payload: z
      .object({
        scanId: identifierSchema,
        acceptedAt: timestampSchema
      })
      .strict()
  })
  .strict()

export const ScanProgressEventMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('event'),
    event: z.literal('scan.progress'),
    payload: ScanProgressSchema
  })
  .strict()

export const ScanResultEventMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('event'),
    event: z.literal('scan.result'),
    payload: ScanResultSummarySchema
  })
  .strict()

export const DeviceRevokeRequestMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('request'),
    route: z.literal('device.revoke'),
    payload: z
      .object({
        deviceId: identifierSchema
      })
      .strict()
  })
  .strict()

export const DeviceRevokeResponseMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('response'),
    route: z.literal('device.revoke'),
    payload: z
      .object({
        deviceId: identifierSchema,
        revokedAt: timestampSchema
      })
      .strict()
  })
  .strict()

export const ErrorMessageSchema = z
  .object({
    ...metadataShape,
    kind: z.literal('error'),
    route: CompanionRouteSchema.optional(),
    error: ProtocolErrorSchema
  })
  .strict()

export const CompanionMessageSchema = z.union([
  PairStartRequestMessageSchema,
  PairStartResponseMessageSchema,
  PairCompleteRequestMessageSchema,
  PairCompleteResponseMessageSchema,
  StatusGetRequestMessageSchema,
  StatusGetResponseMessageSchema,
  ScanStartRequestMessageSchema,
  ScanStartResponseMessageSchema,
  ScanProgressEventMessageSchema,
  ScanResultEventMessageSchema,
  DeviceRevokeRequestMessageSchema,
  DeviceRevokeResponseMessageSchema,
  ErrorMessageSchema
])

export type DeviceCapabilities = z.infer<typeof DeviceCapabilitiesSchema>
export type DiskSummary = z.infer<typeof DiskSummarySchema>
export type PermissionSummary = z.infer<typeof PermissionSummarySchema>
export type ForecastSummary = z.infer<typeof ForecastSummarySchema>
export type ScanRequest = z.infer<typeof ScanRequestSchema>
export type ScanProgress = z.infer<typeof ScanProgressSchema>
export type SanitizedScanItem = z.infer<typeof SanitizedScanItemSchema>
export type ScanResultSummary = z.infer<typeof ScanResultSummarySchema>
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>
export type CompanionMessage = z.infer<typeof CompanionMessageSchema>

export type VersionNegotiationResult =
  | { ok: true; version: typeof COMPANION_PROTOCOL_V1 }
  | { ok: false; error: ProtocolError }

export function negotiateProtocolVersion(peerVersions: readonly string[]): VersionNegotiationResult {
  if (peerVersions.includes(COMPANION_PROTOCOL_V1)) {
    return { ok: true, version: COMPANION_PROTOCOL_V1 }
  }

  return {
    ok: false,
    error: {
      code: 'incompatible-version',
      message: 'Versão incompatível. Atualize o Disk Headroom no celular e no Mac.',
      retryable: false
    }
  }
}
