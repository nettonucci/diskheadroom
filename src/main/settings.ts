import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_DOWNLOADS_MIN_BYTES,
  DEFAULT_DOWNLOADS_MIN_DAYS,
  DEFAULT_LARGE_FILE_MIN_BYTES,
  DEFAULT_LOW_DISK_ALERT,
  DEFAULT_SCAN_CATEGORIES,
  DEFAULT_SCAN_REMINDER,
  DEFAULT_UNUSED_DAYS,
  mergeDownloadsMinBytes,
  mergeDownloadsMinDays,
  mergeLargeFileMinBytes,
  mergeLaunchAtLogin,
  mergeLowDiskAlert,
  mergeNeverTouchPaths,
  mergeScanCategories,
  mergeScanReminder
} from '../shared/constants'
import { resolveLocale } from '../shared/i18n'
import type { AppSettings } from '../shared/types'

const filePath = (): string => join(app.getPath('userData'), 'settings.json')

const defaults = (): AppSettings => ({
  unusedDays: DEFAULT_UNUSED_DAYS,
  setupComplete: false,
  locale: resolveLocale(app.getLocale()),
  scanCategories: { ...DEFAULT_SCAN_CATEGORIES },
  largeFileMinBytes: DEFAULT_LARGE_FILE_MIN_BYTES,
  downloadsMinDays: DEFAULT_DOWNLOADS_MIN_DAYS,
  downloadsMinBytes: DEFAULT_DOWNLOADS_MIN_BYTES,
  lowDiskAlert: { ...DEFAULT_LOW_DISK_ALERT },
  launchAtLogin: false,
  scanReminder: { ...DEFAULT_SCAN_REMINDER },
  neverTouchPaths: []
})

function appSettingsBody(next: AppSettings): AppSettings {
  return {
    unusedDays: next.unusedDays,
    setupComplete: next.setupComplete,
    locale: next.locale,
    scanCategories: next.scanCategories,
    largeFileMinBytes: next.largeFileMinBytes,
    downloadsMinDays: next.downloadsMinDays,
    downloadsMinBytes: next.downloadsMinBytes,
    lowDiskAlert: next.lowDiskAlert,
    launchAtLogin: next.launchAtLogin,
    scanReminder: next.scanReminder,
    neverTouchPaths: next.neverTouchPaths
  }
}

function parseSettings(raw: string): AppSettings {
  const parsed = JSON.parse(raw) as Record<string, unknown>
  delete parsed.licenseKey
  const data = parsed as Partial<AppSettings>
  return {
    ...defaults(),
    ...data,
    locale: data.locale ? resolveLocale(data.locale) : defaults().locale,
    scanCategories: mergeScanCategories(data.scanCategories),
    largeFileMinBytes: mergeLargeFileMinBytes(data.largeFileMinBytes),
    downloadsMinDays: mergeDownloadsMinDays(data.downloadsMinDays),
    downloadsMinBytes: mergeDownloadsMinBytes(data.downloadsMinBytes),
    lowDiskAlert: mergeLowDiskAlert(data.lowDiskAlert),
    launchAtLogin: mergeLaunchAtLogin(data.launchAtLogin),
    scanReminder: mergeScanReminder(data.scanReminder),
    neverTouchPaths: mergeNeverTouchPaths(data.neverTouchPaths)
  }
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    return parseSettings(await readFile(filePath(), 'utf8'))
  } catch {
    return defaults()
  }
}

/** Fallback copy of a license key. Never returned from `loadSettings`. */
export async function peekLicenseKeyFallback(): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath(), 'utf8')) as { licenseKey?: unknown }
    return typeof parsed.licenseKey === 'string' && parsed.licenseKey.trim()
      ? parsed.licenseKey.trim()
      : null
  } catch {
    return null
  }
}

export async function setLicenseKeyFallback(key: string | null): Promise<void> {
  const settings = await loadSettings()
  await mkdir(app.getPath('userData'), { recursive: true })
  const body = key ? { ...settings, licenseKey: key } : settings
  await writeFile(filePath(), JSON.stringify(body, null, 2), 'utf8')
}

export async function saveSettings(next: AppSettings): Promise<void> {
  const licenseKey = await peekLicenseKeyFallback()
  await mkdir(app.getPath('userData'), { recursive: true })
  const body = licenseKey ? { ...appSettingsBody(next), licenseKey } : appSettingsBody(next)
  await writeFile(filePath(), JSON.stringify(body, null, 2), 'utf8')
}
