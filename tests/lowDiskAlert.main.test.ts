import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCAN_CATEGORIES, GIGABYTE_BYTES } from '../src/shared/constants'
import type { AppSettings } from '../src/shared/types'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  getPath: vi.fn(() => '/tmp/diskheadroom'),
  isSupported: vi.fn(() => true),
  show: vi.fn(),
  on: vi.fn(),
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
    Notification
  }
})

vi.mock('../src/main/disk', () => ({
  getDiskInfo: vi.fn()
}))
vi.mock('../src/main/settings', () => ({
  loadSettings: vi.fn()
}))

import { startLowDiskAlertWatcher } from '../src/main/lowDiskAlert'

const enabled: AppSettings = {
  unusedDays: 90,
  setupComplete: true,
  locale: 'en',
  scanCategories: DEFAULT_SCAN_CATEGORIES,
  lowDiskAlert: { enabled: true, kind: 'percent', value: 10 }
}

const disabled: AppSettings = {
  ...enabled,
  lowDiskAlert: { ...enabled.lowDiskAlert, enabled: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.lastNotification = null
  mocks.isSupported.mockReturnValue(true)
  mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
})

describe('low-disk notification watcher', () => {
  it('does not notify when the setting is off', async () => {
    const showWindow = vi.fn()
    const watcher = startLowDiskAlertWatcher({
      showWindow,
      intervalMs: 60_000,
      getDiskInfo: vi.fn().mockResolvedValue({ totalBytes: 1000, freeBytes: 50, usedBytes: 950, mount: '/' }),
      loadSettings: vi.fn().mockResolvedValue(disabled)
    })
    await vi.waitFor(() => expect(mocks.readFile).toHaveBeenCalled())
    expect(mocks.show).not.toHaveBeenCalled()
    watcher.stop()
  })

  it('shows a local notification once per cooldown and opens the window on click', async () => {
    const showWindow = vi.fn()
    let now = 1_000
    const getDiskInfo = vi.fn().mockResolvedValue({
      totalBytes: 1000,
      freeBytes: 50,
      usedBytes: 950,
      mount: '/'
    })
    const watcher = startLowDiskAlertWatcher({
      showWindow,
      intervalMs: 60_000,
      now: () => now,
      getDiskInfo,
      loadSettings: vi.fn().mockResolvedValue(enabled)
    })

    await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(1))
    expect(mocks.lastNotification).toMatchObject({
      title: 'Low disk space',
      body: expect.stringContaining('5%')
    })
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/diskheadroom/low-disk-alert-state.json',
      JSON.stringify({ lastFiredAt: 1000 }),
      'utf8'
    )

    const click = mocks.on.mock.calls.find((call) => call[0] === 'click')?.[1] as () => void
    click()
    expect(showWindow).toHaveBeenCalled()

    now += 60_000
    watcher.setSettings(enabled)
    await Promise.resolve()
    await Promise.resolve()
    expect(mocks.show).toHaveBeenCalledTimes(1)

    now += 12 * 60 * 60 * 1000
    watcher.setSettings(enabled)
    await vi.waitFor(() => expect(mocks.show).toHaveBeenCalledTimes(2))
    watcher.stop()
  })

  it('simulates free space, runs the real check and clears the cooldown for the Debug tab', async () => {
    const roomy = {
      totalBytes: 100 * GIGABYTE_BYTES,
      freeBytes: 40 * GIGABYTE_BYTES,
      usedBytes: 60 * GIGABYTE_BYTES,
      mount: '/'
    }
    const watcher = startLowDiskAlertWatcher({
      showWindow: vi.fn(),
      now: () => 5_000,
      getDiskInfo: vi.fn().mockResolvedValue(roomy),
      loadSettings: vi.fn().mockResolvedValue(enabled)
    })
    // checkNow awaits the startup check, so the simulation below cannot race it.
    await watcher.checkNow()
    expect(mocks.show).not.toHaveBeenCalled()
    await expect(watcher.getStatus()).resolves.toMatchObject({
      belowThreshold: false,
      simulatedFreePercent: null,
      realFreeBytes: 40 * GIGABYTE_BYTES,
      lastFiredAt: null,
      notificationsSupported: true
    })

    watcher.simulateFreePercent(3)
    await expect(watcher.getStatus()).resolves.toMatchObject({
      belowThreshold: true,
      simulatedFreePercent: 3,
      realFreeBytes: 40 * GIGABYTE_BYTES,
      disk: expect.objectContaining({ freeBytes: 3 * GIGABYTE_BYTES })
    })

    await watcher.checkNow()
    expect(mocks.show).toHaveBeenCalledTimes(1)
    await watcher.checkNow()
    expect(mocks.show).toHaveBeenCalledTimes(1)

    await watcher.resetCooldown()
    await expect(watcher.getStatus()).resolves.toMatchObject({ lastFiredAt: null })
    await watcher.checkNow()
    expect(mocks.show).toHaveBeenCalledTimes(2)

    watcher.simulateFreePercent(null)
    await expect(watcher.getStatus()).resolves.toMatchObject({
      belowThreshold: false,
      simulatedFreePercent: null
    })
    watcher.stop()
  })

  it('clamps a simulated percentage and sends a test notification without spending the cooldown', async () => {
    const watcher = startLowDiskAlertWatcher({
      showWindow: vi.fn(),
      getDiskInfo: vi.fn().mockResolvedValue({
        totalBytes: 100 * GIGABYTE_BYTES,
        freeBytes: 40 * GIGABYTE_BYTES,
        usedBytes: 60 * GIGABYTE_BYTES,
        mount: '/'
      }),
      loadSettings: vi.fn().mockResolvedValue(enabled)
    })
    await watcher.checkNow()
    expect(mocks.show).not.toHaveBeenCalled()

    watcher.simulateFreePercent(-20)
    await expect(watcher.getStatus()).resolves.toMatchObject({ simulatedFreePercent: 0 })
    watcher.simulateFreePercent(400)
    await expect(watcher.getStatus()).resolves.toMatchObject({ simulatedFreePercent: 100 })
    watcher.simulateFreePercent(Number.NaN)
    await expect(watcher.getStatus()).resolves.toMatchObject({ simulatedFreePercent: null })

    await expect(watcher.notifyNow()).resolves.toBe(true)
    expect(mocks.show).toHaveBeenCalledTimes(1)
    await expect(watcher.getStatus()).resolves.toMatchObject({ lastFiredAt: null })
    watcher.stop()
  })

  it('skips Notification Center when the platform cannot show alerts', async () => {
    mocks.isSupported.mockReturnValue(false)
    const watcher = startLowDiskAlertWatcher({
      showWindow: vi.fn(),
      getDiskInfo: vi.fn().mockResolvedValue({
        totalBytes: 10 * GIGABYTE_BYTES,
        freeBytes: GIGABYTE_BYTES,
        usedBytes: 9 * GIGABYTE_BYTES,
        mount: '/'
      }),
      loadSettings: vi.fn().mockResolvedValue(enabled)
    })
    await vi.waitFor(() => expect(mocks.readFile).toHaveBeenCalled())
    expect(mocks.show).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
    watcher.stop()
  })
})
