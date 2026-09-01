import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DAY_MS, DEFAULT_SCAN_CATEGORIES } from '../src/shared/constants'
import type { AppSettings } from '../src/shared/types'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  getPath: vi.fn(() => '/tmp/diskheadroom'),
  isSupported: vi.fn(() => true),
  show: vi.fn(),
  on: vi.fn(),
  trashItem: vi.fn(),
  lastNotification: null as { title?: string; body?: string } | null
}))

vi.mock('node:fs/promises', () => {
  const module = { readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: mocks.mkdir }
  return { default: module, ...module }
})

vi.mock('electron', () => {
  class Notification {
    constructor(options: { title?: string; body?: string }) {
      mocks.lastNotification = options
    }
    on = mocks.on
    show = mocks.show
    static isSupported = mocks.isSupported
  }
  return {
    app: { getPath: mocks.getPath },
    Notification,
    shell: { trashItem: mocks.trashItem }
  }
})

vi.mock('../src/main/settings', () => ({
  loadSettings: vi.fn()
}))

import { startScanReminderWatcher } from '../src/main/scanReminder'

const enabled: AppSettings = {
  unusedDays: 90,
  setupComplete: true,
  locale: 'en',
  scanCategories: DEFAULT_SCAN_CATEGORIES,
  lowDiskAlert: { enabled: false, kind: 'percent', value: 10 },
  launchAtLogin: false,
  scanReminder: { enabled: true, intervalDays: 7 }
}

const disabled: AppSettings = {
  ...enabled,
  scanReminder: { ...enabled.scanReminder, enabled: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.lastNotification = null
  mocks.isSupported.mockReturnValue(true)
  mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
})

describe('scan reminder watcher', () => {
  it('does not notify when the setting is off', async () => {
    const watcher = startScanReminderWatcher({
      showWindow: vi.fn(),
      intervalMs: 60_000,
      loadSettings: vi.fn().mockResolvedValue(disabled)
    })
    await vi.waitFor(() => expect(mocks.readFile).toHaveBeenCalled())
    expect(mocks.show).not.toHaveBeenCalled()
    expect(mocks.trashItem).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('starts the clock on first enable without firing immediately', async () => {
    let now = 1_000
    const watcher = startScanReminderWatcher({
      showWindow: vi.fn(),
      intervalMs: 60_000,
      now: () => now,
      loadSettings: vi.fn().mockResolvedValue(enabled)
    })
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalled())
    expect(mocks.show).not.toHaveBeenCalled()
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/diskheadroom/scan-reminder-state.json',
      JSON.stringify({ lastRemindedAt: 1000, lastScanAt: null }),
      'utf8'
    )
    watcher.stop()
  })

  it('shows a local reminder after the interval and never moves files to Trash', async () => {
    const showWindow = vi.fn()
    let now = 1_000
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ lastRemindedAt: now - 7 * DAY_MS, lastScanAt: null })
    )
    const watcher = startScanReminderWatcher({
      showWindow,
      intervalMs: 60_000,
      now: () => now,
      loadSettings: vi.fn().mockResolvedValue(enabled)
    })

    await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1))
    expect(mocks.lastNotification).toMatchObject({
      title: 'Time for a scan',
      body: expect.stringContaining('Trash')
    })
    expect(mocks.trashItem).not.toHaveBeenCalled()

    const click = mocks.on.mock.calls.find((call) => call[0] === 'click')?.[1] as () => void
    click()
    expect(showWindow).toHaveBeenCalled()
    expect(mocks.trashItem).not.toHaveBeenCalled()

    now += 60_000
    await watcher.checkNow()
    expect(mocks.show).toHaveBeenCalledTimes(1)

    now += 7 * DAY_MS
    await watcher.checkNow()
    await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2))
    expect(mocks.trashItem).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('delays the next reminder after a completed scan', async () => {
    let now = 1_000
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ lastRemindedAt: now - 7 * DAY_MS, lastScanAt: null })
    )
    const watcher = startScanReminderWatcher({
      showWindow: vi.fn(),
      intervalMs: 60_000,
      now: () => now,
      loadSettings: vi.fn().mockResolvedValue(enabled)
    })
    await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1))

    now += 7 * DAY_MS
    await watcher.markScanComplete()
    await watcher.checkNow()
    expect(mocks.show).toHaveBeenCalledTimes(1)
    expect(mocks.trashItem).not.toHaveBeenCalled()
    watcher.stop()
  })
})
