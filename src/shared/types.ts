import type {
  LowDiskAlertSettings,
  ScanCategoryFlags,
  ScanReminderSettings,
  UnusedDays
} from './constants'
import type { Locale, TranslationKey } from './i18n'

export type ScanCategoryId =
  | 'userCaches'
  | 'userLogs'
  | 'homebrewCache'
  | 'packageManagerCaches'
  | 'trash'
  | 'xcodeDerivedData'
  | 'iosDeviceSupport'
  | 'xcodeArchives'
  | 'unavailableSimulators'
  | 'outdatedSimulators'
  | 'coreSimulatorCaches'
  | 'dockerDesktop'
  | 'androidDevCaches'
  | 'idleUserFolders'
  | 'unusedApps'

export interface ScanItem {
  id: string
  categoryId: ScanCategoryId
  name: string
  nameKey?: TranslationKey
  path: string
  bytes: number
  selectedByDefault: boolean
  optional: boolean
  lastUsedAt: string | null
  daysIdle: number | null
}

export interface ScanProgress {
  phase: TranslationKey
  percent: number
}

export interface CategorySnapshot {
  scannedAt: string
  categories: Partial<Record<ScanCategoryId, number>>
  totalBytes: number
}

export type CategoryDeltaStatus = 'grew' | 'shrank' | 'same' | 'new' | 'disabled'

export interface CategoryDelta {
  categoryId: ScanCategoryId
  currentBytes: number
  previousBytes: number | null
  deltaBytes: number | null
  status: CategoryDeltaStatus
}

export interface ScanDeltaSummary {
  isPro: boolean
  hasPreviousScan: boolean
  previousScannedAt: string | null
  currentScannedAt: string
  totalCurrentBytes: number
  totalPreviousBytes: number | null
  totalDeltaBytes: number | null
  categories: Partial<Record<ScanCategoryId, CategoryDelta>>
}

export interface ScanResult {
  items: ScanItem[]
  scannedAt: string
  limited: boolean
  deltas?: ScanDeltaSummary
}

export interface DiskInfo {
  mount: string
  totalBytes: number
  freeBytes: number
  usedBytes: number
}

export interface PermissionStatus {
  fullDiskAccess: boolean
  libraryCachesReadable: boolean
  applicationsReadable: boolean
}

export interface GrantTarget {
  displayName: string
  bundlePath: string
  packaged: boolean
  launchedBy: string | null
}

export interface AppSettings {
  unusedDays: UnusedDays
  setupComplete: boolean
  locale: Locale
  scanCategories: ScanCategoryFlags
  lowDiskAlert: LowDiskAlertSettings
  launchAtLogin: boolean
  scanReminder: ScanReminderSettings
  isPro: boolean
}

/** Development-only snapshot behind the Debug tab. Never registered in a packaged build. */
export interface LowDiskDebugStatus {
  disk: DiskInfo
  realFreeBytes: number
  simulatedFreePercent: number | null
  alert: LowDiskAlertSettings
  belowThreshold: boolean
  lastFiredAt: number | null
  cooldownMs: number
  notificationsSupported: boolean
}

export interface CleanRequest {
  paths: string[]
}

export interface CleanResult {
  trashed: string[]
  failed: { path: string; error: string }[]
  bytesRequested: number
}
