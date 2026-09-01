import { app, Notification } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SCAN_REMINDER_CHECK_INTERVAL_MS } from '../shared/constants'
import { translate } from '../shared/i18n'
import { shouldFireScanReminder } from '../shared/scanReminder'
import type { AppSettings } from '../shared/types'
import { loadSettings } from './settings'

interface ReminderState {
  lastRemindedAt: number | null
  lastScanAt: number | null
}

export interface ScanReminderWatcher {
  setSettings: (settings: AppSettings) => void
  markScanComplete: () => Promise<void>
  checkNow: () => Promise<void>
  stop: () => void
}

interface WatcherOptions {
  showWindow: () => void
  intervalMs?: number
  now?: () => number
  loadSettings?: () => Promise<AppSettings>
  showNotification?: (payload: { title: string; body: string; onClick: () => void }) => boolean
}

const statePath = (): string => join(app.getPath('userData'), 'scan-reminder-state.json')

function parseTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

async function loadState(): Promise<ReminderState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<ReminderState>
    return {
      lastRemindedAt: parseTimestamp(parsed.lastRemindedAt),
      lastScanAt: parseTimestamp(parsed.lastScanAt)
    }
  } catch {
    return { lastRemindedAt: null, lastScanAt: null }
  }
}

async function saveState(state: ReminderState): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(statePath(), JSON.stringify(state), 'utf8')
}

export function showNativeScanReminderNotification(payload: {
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

export function startScanReminderWatcher(options: WatcherOptions): ScanReminderWatcher {
  let settings: AppSettings | null = null
  let lastRemindedAt: number | null = null
  let lastScanAt: number | null = null
  let checking = false
  const now = options.now ?? Date.now
  const readSettings = options.loadSettings ?? loadSettings
  const notify = options.showNotification ?? showNativeScanReminderNotification

  async function currentSettings(): Promise<AppSettings> {
    if (!settings) settings = await readSettings()
    return settings
  }

  async function persist(): Promise<void> {
    await saveState({ lastRemindedAt, lastScanAt })
  }

  // First enable (or a settings file with the flag on and no state yet) starts
  // the clock. It must not fire a reminder on that same launch.
  async function ensureBaseline(current: AppSettings): Promise<void> {
    if (!current.scanReminder.enabled) return
    if (lastRemindedAt != null || lastScanAt != null) return
    lastRemindedAt = now()
    await persist()
  }

  async function check(): Promise<void> {
    if (checking) return
    checking = true
    try {
      const current = await currentSettings()
      await ensureBaseline(current)
      if (
        !shouldFireScanReminder({
          enabled: current.scanReminder.enabled,
          now: now(),
          intervalDays: current.scanReminder.intervalDays,
          lastRemindedAt,
          lastScanAt
        })
      ) {
        return
      }
      const shown = notify({
        title: translate(current.locale, 'alert.scanReminder.title'),
        body: translate(current.locale, 'alert.scanReminder.body'),
        onClick: options.showWindow
      })
      if (!shown) return
      lastRemindedAt = now()
      await persist()
    } catch {
      // A denied Notification Center must not take the app down.
    } finally {
      checking = false
    }
  }

  const ready = loadState().then((state) => {
    lastRemindedAt = state.lastRemindedAt
    lastScanAt = state.lastScanAt
    return check()
  })

  const timer = setInterval(() => {
    void ready.then(() => check())
  }, options.intervalMs ?? SCAN_REMINDER_CHECK_INTERVAL_MS)

  return {
    setSettings(next) {
      const previous = settings
      settings = next
      if (next.scanReminder.enabled && previous && !previous.scanReminder.enabled) {
        lastRemindedAt = now()
        void persist()
      }
      void ready.then(() => check())
    },
    async markScanComplete() {
      lastScanAt = now()
      await persist()
    },
    async checkNow() {
      await ready
      await check()
    },
    stop() {
      clearInterval(timer)
    }
  }
}
