import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  DEFAULT_SCAN_REMINDER,
  mergeLaunchAtLogin,
  mergeScanReminder
} from '../src/shared/constants'
import { shouldFireScanReminder } from '../src/shared/scanReminder'

describe('scan reminder schedule', () => {
  const now = 1_000_000

  it('does not fire when the setting is off or the clock has not started', () => {
    expect(
      shouldFireScanReminder({
        enabled: false,
        now,
        intervalDays: 7,
        lastRemindedAt: now - 8 * DAY_MS,
        lastScanAt: null
      })
    ).toBe(false)
    expect(
      shouldFireScanReminder({
        enabled: true,
        now,
        intervalDays: 7,
        lastRemindedAt: null,
        lastScanAt: null
      })
    ).toBe(false)
  })

  it('fires after the chosen interval since the last reminder or scan', () => {
    expect(
      shouldFireScanReminder({
        enabled: true,
        now,
        intervalDays: 7,
        lastRemindedAt: now - 7 * DAY_MS,
        lastScanAt: null
      })
    ).toBe(true)
    expect(
      shouldFireScanReminder({
        enabled: true,
        now,
        intervalDays: 7,
        lastRemindedAt: now - 7 * DAY_MS + 1,
        lastScanAt: null
      })
    ).toBe(false)
    expect(
      shouldFireScanReminder({
        enabled: true,
        now,
        intervalDays: 7,
        lastRemindedAt: now - 8 * DAY_MS,
        lastScanAt: now - 2 * DAY_MS
      })
    ).toBe(false)
  })
})

describe('scan reminder and login settings merge', () => {
  it('keeps conservative defaults for missing or malformed input', () => {
    expect(mergeScanReminder(undefined)).toEqual(DEFAULT_SCAN_REMINDER)
    expect(mergeScanReminder({ enabled: 'yes', intervalDays: 3 })).toEqual(DEFAULT_SCAN_REMINDER)
    expect(mergeScanReminder({ enabled: true, intervalDays: 14 })).toEqual({
      enabled: true,
      intervalDays: 14
    })
    expect(mergeLaunchAtLogin(undefined)).toBe(false)
    expect(mergeLaunchAtLogin('yes')).toBe(false)
    expect(mergeLaunchAtLogin(true)).toBe(true)
  })
})
