export const SPONSORS_URL = 'https://github.com/sponsors/nettonucci'
export const REPO_URL = 'https://github.com/nettonucci/diskheadroom'
export const APP_NAME = 'Disk Headroom'

export const UNUSED_DAY_OPTIONS = [30, 90, 180, 365] as const
export type UnusedDays = (typeof UNUSED_DAY_OPTIONS)[number]
export const DEFAULT_UNUSED_DAYS: UnusedDays = 90

/** Scan phases the user can turn off. Order drives the Settings list. */
export const SCAN_CATEGORY_IDS = [
  'userCaches',
  'userLogs',
  'homebrewCache',
  'packageManagers',
  'trash',
  'xcode',
  'androidDev',
  'docker',
  'idleUserFolders',
  'unusedApps'
] as const
export type ScanCategoryFlag = (typeof SCAN_CATEGORY_IDS)[number]
export type ScanCategoryFlags = Record<ScanCategoryFlag, boolean>

export const DEFAULT_SCAN_CATEGORIES: ScanCategoryFlags = {
  userCaches: true,
  userLogs: true,
  homebrewCache: true,
  packageManagers: true,
  trash: true,
  xcode: true,
  androidDev: true,
  docker: true,
  idleUserFolders: true,
  unusedApps: true
}

// Settings saved before a phase existed omit its flag, and the renderer can send
// anything over IPC, so unknown or non-boolean values fall back to the default.
export function mergeScanCategories(
  input: Partial<ScanCategoryFlags> | null | undefined
): ScanCategoryFlags {
  const next = { ...DEFAULT_SCAN_CATEGORIES }
  if (!input || typeof input !== 'object') return next
  for (const id of SCAN_CATEGORY_IDS) {
    if (typeof input[id] === 'boolean') next[id] = input[id]
  }
  return next
}

export const LOW_DISK_ALERT_KINDS = ['percent', 'gigabytes'] as const
export type LowDiskAlertKind = (typeof LOW_DISK_ALERT_KINDS)[number]

export interface LowDiskAlertSettings {
  enabled: boolean
  kind: LowDiskAlertKind
  value: number
}

export const DEFAULT_LOW_DISK_ALERT: LowDiskAlertSettings = {
  enabled: false,
  kind: 'percent',
  value: 10
}

export const LOW_DISK_ALERT_PRESETS: ReadonlyArray<Omit<LowDiskAlertSettings, 'enabled'>> = [
  { kind: 'percent', value: 5 },
  { kind: 'percent', value: 10 },
  { kind: 'percent', value: 15 },
  { kind: 'gigabytes', value: 5 },
  { kind: 'gigabytes', value: 10 },
  { kind: 'gigabytes', value: 20 }
]

export const LOW_DISK_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000
export const LOW_DISK_ALERT_INTERVAL_MS = 60 * 1000
export const GIGABYTE_BYTES = 1024 ** 3

// Older settings.json files omit the alert block. IPC can send anything, so
// unknown kinds or non-numeric values fall back to the conservative default.
export function mergeLowDiskAlert(input: unknown): LowDiskAlertSettings {
  const next = { ...DEFAULT_LOW_DISK_ALERT }
  if (!input || typeof input !== 'object') return next
  const raw = input as Partial<LowDiskAlertSettings>
  if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled
  if (raw.kind === 'percent' || raw.kind === 'gigabytes') next.kind = raw.kind
  if (typeof raw.value === 'number' && Number.isFinite(raw.value) && raw.value > 0) {
    next.value = Math.round(raw.value)
  }
  return next
}

export function lowDiskAlertPresetKey(kind: LowDiskAlertKind, value: number): string {
  return `${kind}:${value}`
}

export function parseLowDiskAlertPreset(value: string): Omit<LowDiskAlertSettings, 'enabled'> | null {
  const [kind, raw] = value.split(':')
  const amount = Number(raw)
  if ((kind !== 'percent' && kind !== 'gigabytes') || !Number.isFinite(amount) || amount <= 0) {
    return null
  }
  return { kind, value: amount }
}

export const SCAN_REMINDER_INTERVAL_DAYS = [7, 14, 30] as const
export type ScanReminderIntervalDays = (typeof SCAN_REMINDER_INTERVAL_DAYS)[number]

export interface ScanReminderSettings {
  enabled: boolean
  intervalDays: ScanReminderIntervalDays
}

export const DEFAULT_SCAN_REMINDER: ScanReminderSettings = {
  enabled: false,
  intervalDays: 7
}

export const DAY_MS = 24 * 60 * 60 * 1000
export const SCAN_REMINDER_CHECK_INTERVAL_MS = 15 * 60 * 1000

export function mergeScanReminder(input: unknown): ScanReminderSettings {
  const next = { ...DEFAULT_SCAN_REMINDER }
  if (!input || typeof input !== 'object') return next
  const raw = input as Partial<ScanReminderSettings>
  if (typeof raw.enabled === 'boolean') next.enabled = raw.enabled
  if (
    typeof raw.intervalDays === 'number' &&
    (SCAN_REMINDER_INTERVAL_DAYS as readonly number[]).includes(raw.intervalDays)
  ) {
    next.intervalDays = raw.intervalDays as ScanReminderIntervalDays
  }
  return next
}

export function mergeLaunchAtLogin(input: unknown): boolean {
  return input === true
}

export const DEFAULT_IS_PRO = false

export function mergeIsPro(input: unknown): boolean {
  return input === true
}
