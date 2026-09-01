import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LOW_DISK_ALERT,
  GIGABYTE_BYTES,
  LOW_DISK_ALERT_COOLDOWN_MS,
  mergeLowDiskAlert,
  parseLowDiskAlertPreset
} from '../src/shared/constants'
import { isBelowLowDiskThreshold, shouldFireLowDiskAlert } from '../src/shared/lowDiskAlert'

describe('low-disk threshold', () => {
  const disk = { totalBytes: 1000, freeBytes: 80 }

  it('treats free space under the percent as below threshold', () => {
    expect(isBelowLowDiskThreshold(disk, { enabled: true, kind: 'percent', value: 10 })).toBe(true)
    expect(isBelowLowDiskThreshold(disk, { enabled: true, kind: 'percent', value: 8 })).toBe(false)
  })

  it('treats free space under a gigabyte floor as below threshold', () => {
    const tight = { totalBytes: 20 * GIGABYTE_BYTES, freeBytes: 4 * GIGABYTE_BYTES }
    expect(isBelowLowDiskThreshold(tight, { enabled: true, kind: 'gigabytes', value: 5 })).toBe(true)
    expect(isBelowLowDiskThreshold(tight, { enabled: true, kind: 'gigabytes', value: 4 })).toBe(false)
  })

  it('ignores malformed disk readings', () => {
    expect(
      isBelowLowDiskThreshold({ totalBytes: 0, freeBytes: 0 }, { enabled: true, kind: 'percent', value: 10 })
    ).toBe(false)
    expect(
      isBelowLowDiskThreshold(
        { totalBytes: Number.NaN, freeBytes: 10 },
        { enabled: true, kind: 'percent', value: 10 }
      )
    ).toBe(false)
  })
})

describe('low-disk cooldown', () => {
  const now = 1_000_000

  it('does not fire when the setting is off or space is still fine', () => {
    expect(
      shouldFireLowDiskAlert({
        enabled: false,
        belowThreshold: true,
        now,
        lastFiredAt: null
      })
    ).toBe(false)
    expect(
      shouldFireLowDiskAlert({
        enabled: true,
        belowThreshold: false,
        now,
        lastFiredAt: null
      })
    ).toBe(false)
  })

  it('fires once while below threshold, then waits for the cooldown', () => {
    expect(
      shouldFireLowDiskAlert({
        enabled: true,
        belowThreshold: true,
        now,
        lastFiredAt: null
      })
    ).toBe(true)
    expect(
      shouldFireLowDiskAlert({
        enabled: true,
        belowThreshold: true,
        now,
        lastFiredAt: now
      })
    ).toBe(false)
    expect(
      shouldFireLowDiskAlert({
        enabled: true,
        belowThreshold: true,
        now: now + LOW_DISK_ALERT_COOLDOWN_MS - 1,
        lastFiredAt: now
      })
    ).toBe(false)
    expect(
      shouldFireLowDiskAlert({
        enabled: true,
        belowThreshold: true,
        now: now + LOW_DISK_ALERT_COOLDOWN_MS,
        lastFiredAt: now
      })
    ).toBe(true)
  })
})

describe('low-disk settings merge', () => {
  it('keeps the conservative default for missing or malformed input', () => {
    expect(mergeLowDiskAlert(undefined)).toEqual(DEFAULT_LOW_DISK_ALERT)
    expect(mergeLowDiskAlert({ enabled: 'yes', kind: 'tb', value: -1 })).toEqual(DEFAULT_LOW_DISK_ALERT)
    expect(mergeLowDiskAlert({ enabled: true, kind: 'gigabytes', value: 20 })).toEqual({
      enabled: true,
      kind: 'gigabytes',
      value: 20
    })
  })

  it('parses preset keys used by the settings select', () => {
    expect(parseLowDiskAlertPreset('percent:10')).toEqual({ kind: 'percent', value: 10 })
    expect(parseLowDiskAlertPreset('gigabytes:5')).toEqual({ kind: 'gigabytes', value: 5 })
    expect(parseLowDiskAlertPreset('nope')).toBeNull()
  })
})
