import type { Locale } from './i18n'

export const SPONSORS_URL = 'https://github.com/sponsors/nettonucci'
export const REPO_URL = 'https://github.com/nettonucci/diskheadroom'
export const SITE_URL = 'https://www.diskheadroom.com'
export const APP_NAME = 'Disk Headroom'

const SITE_HOSTS = new Set(['diskheadroom.com', 'www.diskheadroom.com'])

/**
 * Pro checkout lives on the site, where Paddle.js opens the overlay. The app
 * only ever verifies the signed key offline, so no Paddle token, product id, or
 * API secret needs to exist in this repository.
 */
export function proCheckoutUrl(locale: Locale): string {
  return `${SITE_URL}/${locale}/pro`
}

/** HTTPS GitHub links and the Disk Headroom site only. */
export function isAllowedExternalUrl(url: unknown): boolean {
  if (typeof url !== 'string' || !url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    if (parsed.username || parsed.password) return false
    if (parsed.hostname === 'github.com') return true
    return SITE_HOSTS.has(parsed.hostname)
  } catch {
    return false
  }
}

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
  'largeFiles',
  'downloadsReview',
  'unusedApps'
] as const
export type ScanCategoryFlag = (typeof SCAN_CATEGORY_IDS)[number]
export type ScanCategoryFlags = Record<ScanCategoryFlag, boolean>

/** Categories that walk user files and require a valid Pro key in main. */
export const PRO_SCAN_CATEGORY_IDS = ['largeFiles', 'downloadsReview'] as const
export type ProScanCategoryId = (typeof PRO_SCAN_CATEGORY_IDS)[number]

export function isProScanCategory(id: ScanCategoryFlag): boolean {
  return (PRO_SCAN_CATEGORY_IDS as readonly string[]).includes(id)
}

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
  largeFiles: false,
  downloadsReview: false,
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

export const LARGE_FILE_MIN_BYTES_OPTIONS = [
  100 * 1024 * 1024,
  250 * 1024 * 1024,
  500 * 1024 * 1024,
  1024 * 1024 * 1024,
  2 * 1024 * 1024 * 1024,
  5 * 1024 * 1024 * 1024
] as const
export type LargeFileMinBytes = (typeof LARGE_FILE_MIN_BYTES_OPTIONS)[number]
export const DEFAULT_LARGE_FILE_MIN_BYTES: LargeFileMinBytes = 500 * 1024 * 1024

export function mergeLargeFileMinBytes(input: unknown): LargeFileMinBytes {
  if (
    typeof input === 'number' &&
    (LARGE_FILE_MIN_BYTES_OPTIONS as readonly number[]).includes(input)
  ) {
    return input as LargeFileMinBytes
  }
  return DEFAULT_LARGE_FILE_MIN_BYTES
}

export const DOWNLOADS_MIN_DAYS_OPTIONS = [0, 7, 14, 30, 60, 90, 180, 365] as const
export type DownloadsMinDays = (typeof DOWNLOADS_MIN_DAYS_OPTIONS)[number]
export const DEFAULT_DOWNLOADS_MIN_DAYS: DownloadsMinDays = 30

export const DOWNLOADS_MIN_BYTES_OPTIONS = [
  0,
  10 * 1024 * 1024,
  50 * 1024 * 1024,
  100 * 1024 * 1024,
  500 * 1024 * 1024,
  1024 * 1024 * 1024
] as const
export type DownloadsMinBytes = (typeof DOWNLOADS_MIN_BYTES_OPTIONS)[number]
export const DEFAULT_DOWNLOADS_MIN_BYTES: DownloadsMinBytes = 50 * 1024 * 1024

export function mergeDownloadsMinDays(input: unknown): DownloadsMinDays {
  if (
    typeof input === 'number' &&
    (DOWNLOADS_MIN_DAYS_OPTIONS as readonly number[]).includes(input)
  ) {
    return input as DownloadsMinDays
  }
  return DEFAULT_DOWNLOADS_MIN_DAYS
}

export function mergeDownloadsMinBytes(input: unknown): DownloadsMinBytes {
  if (
    typeof input === 'number' &&
    (DOWNLOADS_MIN_BYTES_OPTIONS as readonly number[]).includes(input)
  ) {
    return input as DownloadsMinBytes
  }
  return DEFAULT_DOWNLOADS_MIN_BYTES
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

export const DEFAULT_NEVER_TOUCH_PATHS: string[] = []
export const MAX_NEVER_TOUCH_PATHS = 50

/** Absolute prefixes the scanner hides and the cleaner refuses. IPC may send anything. */
export function mergeNeverTouchPaths(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_NEVER_TOUCH_PATHS]
  const seen = new Set<string>()
  const next: string[] = []
  for (const item of input) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed.startsWith('/') || trimmed.includes('\0')) continue
    const normalized = trimmed.replace(/\/+$/, '')
    if (!normalized || normalized === '/') continue
    if (seen.has(normalized)) continue
    seen.add(normalized)
    next.push(normalized)
    if (next.length >= MAX_NEVER_TOUCH_PATHS) break
  }
  return next
}
