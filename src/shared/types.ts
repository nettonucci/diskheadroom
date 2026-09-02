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

export interface ScanResult {
  items: ScanItem[]
  scannedAt: string
  limited: boolean
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
  // macOS attributes permissions to the app that launched this process, so a
  // terminal or IDE can override whatever the running bundle was granted.
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
  /** Absolute paths/prefixes omitted from scans and refused by trash. */
  neverTouchPaths: string[]
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
