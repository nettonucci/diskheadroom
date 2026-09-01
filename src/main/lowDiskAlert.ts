import { app, Notification } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LOW_DISK_ALERT_COOLDOWN_MS, LOW_DISK_ALERT_INTERVAL_MS } from '../shared/constants'
import { translate } from '../shared/i18n'
import { freeSpacePercent, isBelowLowDiskThreshold, shouldFireLowDiskAlert } from '../shared/lowDiskAlert'
import type { AppSettings, DiskInfo, LowDiskDebugStatus } from '../shared/types'
import { getDiskInfo } from './disk'
import { loadSettings } from './settings'

interface AlertState {
  lastFiredAt: number | null
}

export interface LowDiskAlertWatcher {
  setSettings: (settings: AppSettings) => void
  checkNow: () => Promise<void>
  resetCooldown: () => Promise<void>
  simulateFreePercent: (percent: number | null) => void
  notifyNow: () => Promise<boolean>
  getStatus: () => Promise<LowDiskDebugStatus>
  stop: () => void
}

interface WatcherOptions {
  showWindow: () => void
  intervalMs?: number
  now?: () => number
  getDiskInfo?: () => Promise<DiskInfo>
  loadSettings?: () => Promise<AppSettings>
  showNotification?: (payload: { title: string; body: string; onClick: () => void }) => boolean
  isNotificationSupported?: () => boolean
}

const statePath = (): string => join(app.getPath('userData'), 'low-disk-alert-state.json')

async function loadState(): Promise<AlertState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<AlertState>
    const last = parsed.lastFiredAt
    return { lastFiredAt: typeof last === 'number' && Number.isFinite(last) ? last : null }
  } catch {
    return { lastFiredAt: null }
  }
}

async function saveState(state: AlertState): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(statePath(), JSON.stringify(state), 'utf8')
}

export function showNativeLowDiskNotification(payload: {
  title: string
  body: string
  onClick: () => void
}): boolean {
  if (!Notification.isSupported()) return false
  const notification = new Notification({
    title: payload.title,
    body: payload.body,
    silent: false
  })
  notification.on('click', payload.onClick)
  notification.show()
  return true
}

export function startLowDiskAlertWatcher(options: WatcherOptions): LowDiskAlertWatcher {
  let settings: AppSettings | null = null
  let lastFiredAt: number | null = null
  let simulatedFreePercent: number | null = null
  let checking = false
  const now = options.now ?? Date.now
  const readDisk = options.getDiskInfo ?? getDiskInfo
  const readSettings = options.loadSettings ?? loadSettings
  const notify = options.showNotification ?? showNativeLowDiskNotification
  const notificationsSupported =
    options.isNotificationSupported ?? ((): boolean => Notification.isSupported())

  async function currentSettings(): Promise<AppSettings> {
    if (!settings) settings = await readSettings()
    return settings
  }

  // The Debug tab can pin free space to a percentage so the real threshold and
  // cooldown path runs on a machine that still has plenty of room.
  async function currentDisk(): Promise<{ effective: DiskInfo; real: DiskInfo }> {
    const real = await readDisk()
    if (simulatedFreePercent == null) return { effective: real, real }
    const freeBytes = Math.round((real.totalBytes * simulatedFreePercent) / 100)
    return {
      effective: {
        ...real,
        freeBytes,
        usedBytes: Math.max(0, real.totalBytes - freeBytes)
      },
      real
    }
  }

  function fire(locale: AppSettings['locale'], disk: DiskInfo): boolean {
    return notify({
      title: translate(locale, 'alert.lowDisk.title'),
      body: translate(locale, 'alert.lowDisk.body', { percent: freeSpacePercent(disk) }),
      onClick: options.showWindow
    })
  }

  async function check(): Promise<void> {
    if (checking) return
    checking = true
    try {
      const current = await currentSettings()
      if (!current.lowDiskAlert.enabled) return
      const { effective } = await currentDisk()
      if (
        !shouldFireLowDiskAlert({
          enabled: current.lowDiskAlert.enabled,
          belowThreshold: isBelowLowDiskThreshold(effective, current.lowDiskAlert),
          now: now(),
          lastFiredAt,
          cooldownMs: LOW_DISK_ALERT_COOLDOWN_MS
        })
      ) {
        return
      }
      if (!fire(current.locale, effective)) return
      lastFiredAt = now()
      await saveState({ lastFiredAt })
    } catch {
      // A failed df or a denied Notification Center must not take the app down.
    } finally {
      checking = false
    }
  }

  const ready = loadState().then((state) => {
    lastFiredAt = state.lastFiredAt
    return check()
  })

  const timer = setInterval(() => {
    void ready.then(() => check())
  }, options.intervalMs ?? LOW_DISK_ALERT_INTERVAL_MS)

  return {
    setSettings(next) {
      settings = next
      void ready.then(() => check())
    },
    async checkNow() {
      await ready
      await check()
    },
    async resetCooldown() {
      lastFiredAt = null
      await saveState({ lastFiredAt: null })
    },
    simulateFreePercent(percent) {
      simulatedFreePercent =
        percent == null || !Number.isFinite(percent) ? null : Math.min(100, Math.max(0, percent))
    },
    async notifyNow() {
      const current = await currentSettings()
      const { effective } = await currentDisk()
      return fire(current.locale, effective)
    },
    async getStatus() {
      const current = await currentSettings()
      const { effective, real } = await currentDisk()
      return {
        disk: effective,
        realFreeBytes: real.freeBytes,
        simulatedFreePercent,
        alert: current.lowDiskAlert,
        belowThreshold: isBelowLowDiskThreshold(effective, current.lowDiskAlert),
        lastFiredAt,
        cooldownMs: LOW_DISK_ALERT_COOLDOWN_MS,
        notificationsSupported: notificationsSupported()
      }
    },
    stop() {
      clearInterval(timer)
    }
  }
}
