import { describe, expect, it } from 'vitest'
import {
  GIGABYTE_BYTES,
  MAX_HEADROOM_SAMPLES,
  MAX_HEADROOM_SAMPLE_AGE_MS,
  mergeIsPro
} from '../src/shared/constants'
import {
  calculateHeadroomForecast,
  calculateSlope,
  calculateThresholdBytes,
  pruneHeadroomSamples
} from '../src/shared/forecast'
import type { HeadroomSample, LowDiskAlertSettings } from '../src/shared/types'

describe('forecast threshold calculation', () => {
  const total = 100 * GIGABYTE_BYTES

  it('calculates threshold from percentage', () => {
    const setting: LowDiskAlertSettings = { enabled: true, kind: 'percent', value: 10 }
    expect(calculateThresholdBytes(total, setting)).toBe(10 * GIGABYTE_BYTES)
  })

  it('calculates threshold from gigabytes', () => {
    const setting: LowDiskAlertSettings = { enabled: true, kind: 'gigabytes', value: 15 }
    expect(calculateThresholdBytes(total, setting)).toBe(15 * GIGABYTE_BYTES)
  })

  it('falls back to default 10% when setting is missing or disabled', () => {
    expect(calculateThresholdBytes(total, undefined)).toBe(10 * GIGABYTE_BYTES)
    expect(calculateThresholdBytes(total, { enabled: false, kind: 'percent', value: 5 })).toBe(
      10 * GIGABYTE_BYTES
    )
  })

  it('handles zero or invalid disk size', () => {
    expect(calculateThresholdBytes(0)).toBe(0)
    expect(calculateThresholdBytes(Number.NaN)).toBe(0)
  })
})

describe('forecast linear regression slope calculation', () => {
  it('returns null for insufficient points or degenerate timestamps', () => {
    expect(calculateSlope([])).toBeNull()
    expect(calculateSlope([[1000, 500]])).toBeNull()
    expect(
      calculateSlope([
        [1000, 500],
        [1000, 400]
      ])
    ).toBeNull()
  })

  it('calculates negative slope accurately for declining space', () => {
    // 1000 ms elapsed, 500 bytes dropped -> slope = -0.5 bytes / ms
    const points: Array<[number, number]> = [
      [1000, 1000],
      [2000, 500]
    ]
    expect(calculateSlope(points)?.slopeBytesPerMs).toBe(-0.5)
  })

  it('calculates slope across multiple noisy sample points with least-squares fit', () => {
    const points: Array<[number, number]> = [
      [0, 100],
      [10, 90],
      [20, 80],
      [30, 70],
      [40, 60]
    ]
    expect(calculateSlope(points)?.slopeBytesPerMs).toBeCloseTo(-1.0)
  })

  it('calculates positive slope when disk space increases', () => {
    const points: Array<[number, number]> = [
      [1000, 200],
      [2000, 400],
      [3000, 600]
    ]
    expect(calculateSlope(points)?.slopeBytesPerMs).toBe(0.2)
  })

  it('calculates zero slope for constant free space', () => {
    const points: Array<[number, number]> = [
      [1000, 500],
      [2000, 500],
      [3000, 500]
    ]
    expect(calculateSlope(points)?.slopeBytesPerMs).toBe(0)
  })
})

describe('forecast sample pruning & security', () => {
  const now = 100_000_000

  it('prunes samples older than retention limit', () => {
    const oldSample: HeadroomSample = {
      timestamp: now - MAX_HEADROOM_SAMPLE_AGE_MS - 1000,
      freeBytes: 50 * GIGABYTE_BYTES,
      totalBytes: 100 * GIGABYTE_BYTES
    }
    const freshSample: HeadroomSample = {
      timestamp: now - 1000,
      freeBytes: 40 * GIGABYTE_BYTES,
      totalBytes: 100 * GIGABYTE_BYTES
    }

    const pruned = pruneHeadroomSamples([oldSample, freshSample], now)
    expect(pruned).toHaveLength(1)
    expect(pruned[0].timestamp).toBe(freshSample.timestamp)
  })

  it('caps samples to maximum count keeping the most recent', () => {
    const samples: HeadroomSample[] = []
    for (let i = 0; i < MAX_HEADROOM_SAMPLES + 20; i++) {
      samples.push({
        timestamp: now - (MAX_HEADROOM_SAMPLES + 20 - i) * 1000,
        freeBytes: (50 + i) * GIGABYTE_BYTES,
        totalBytes: 100 * GIGABYTE_BYTES
      })
    }

    const pruned = pruneHeadroomSamples(samples, now)
    expect(pruned).toHaveLength(MAX_HEADROOM_SAMPLES)
    expect(pruned[pruned.length - 1].timestamp).toBe(samples[samples.length - 1].timestamp)
  })

  it('filters out invalid or non-numeric samples', () => {
    const invalid: unknown[] = [
      null,
      undefined,
      'string',
      { timestamp: 'not-a-number', freeBytes: 100, totalBytes: 200 },
      { timestamp: now, freeBytes: Number.NaN, totalBytes: 200 },
      { timestamp: now, freeBytes: -5, totalBytes: 200 },
      { timestamp: now, freeBytes: 100, totalBytes: -10 }
    ]

    const valid: HeadroomSample = {
      timestamp: now,
      freeBytes: 100,
      totalBytes: 200
    }

    const pruned = pruneHeadroomSamples([...invalid, valid] as HeadroomSample[], now)
    expect(pruned).toEqual([valid])
  })

  it('only stores counts and bytes, never file paths', () => {
    const sampleWithExtraProps: HeadroomSample & { filePath?: string } = {
      timestamp: now,
      freeBytes: 500,
      totalBytes: 1000,
      categoryTotals: { userCaches: 200 },
      filePath: '/Users/secret/file.txt'
    }

    const pruned = pruneHeadroomSamples([sampleWithExtraProps], now)
    expect(pruned[0]).not.toHaveProperty('filePath')
    expect(pruned[0]).toEqual({
      timestamp: now,
      freeBytes: 500,
      totalBytes: 1000,
      categoryTotals: { userCaches: 200 }
    })
  })
})

describe('headroom forecast estimation engine', () => {
  const msPerDay = 24 * 60 * 60 * 1000
  const totalBytes = 100 * GIGABYTE_BYTES
  const thresholdBytes = 10 * GIGABYTE_BYTES // 10 GB threshold

  it('returns gated status when isPro is false', () => {
    const forecast = calculateHeadroomForecast({
      isPro: false,
      samples: [
        { timestamp: 1000, freeBytes: 50 * GIGABYTE_BYTES, totalBytes },
        { timestamp: 2000, freeBytes: 40 * GIGABYTE_BYTES, totalBytes }
      ],
      currentFreeBytes: 40 * GIGABYTE_BYTES,
      totalBytes,
      alertSettings: { enabled: true, kind: 'gigabytes', value: 10 }
    })

    expect(forecast.status).toBe('gated')
    expect(forecast.daysRemaining).toBeNull()
  })

  it('returns insufficient_data status when fewer than 2 samples exist', () => {
    const forecast = calculateHeadroomForecast({
      isPro: true,
      samples: [{ timestamp: 1000, freeBytes: 50 * GIGABYTE_BYTES, totalBytes }],
      currentFreeBytes: 50 * GIGABYTE_BYTES,
      totalBytes
    })

    expect(forecast.status).toBe('insufficient_data')
    expect(forecast.daysRemaining).toBeNull()
  })

  it('returns critical status when current free space is already at or below threshold', () => {
    const forecast = calculateHeadroomForecast({
      isPro: true,
      samples: [
        { timestamp: 1000, freeBytes: 12 * GIGABYTE_BYTES, totalBytes },
        { timestamp: 2000, freeBytes: 8 * GIGABYTE_BYTES, totalBytes }
      ],
      currentFreeBytes: 8 * GIGABYTE_BYTES,
      totalBytes,
      alertSettings: { enabled: true, kind: 'gigabytes', value: 10 },
      now: 2000
    })

    expect(forecast.status).toBe('critical')
    expect(forecast.daysRemaining).toBe(0)
  })

  it('returns steady status when slope is non-negative (space is constant or expanding)', () => {
    const forecast = calculateHeadroomForecast({
      isPro: true,
      samples: [
        { timestamp: 1000, freeBytes: 40 * GIGABYTE_BYTES, totalBytes },
        { timestamp: 1000 + msPerDay, freeBytes: 45 * GIGABYTE_BYTES, totalBytes }
      ],
      currentFreeBytes: 45 * GIGABYTE_BYTES,
      totalBytes,
      alertSettings: { enabled: true, kind: 'gigabytes', value: 10 },
      now: 1000 + msPerDay
    })

    expect(forecast.status).toBe('steady')
    expect(forecast.dailyDeclineBytes).toBe(0)
    expect(forecast.daysRemaining).toBeNull()
  })

  it('calculates days remaining and estimated date for declining rate', () => {
    const startTime = 1_700_000_000_000
    // Decline 2 GB per day:
    // Day 0: 50 GB free
    // Day 5: 40 GB free (Slope: -2 GB / day)
    // Threshold: 10 GB
    // Remaining space above threshold: 40 GB - 10 GB = 30 GB
    // Days remaining: 30 GB / (2 GB / day) = 15 days
    const samples: HeadroomSample[] = [
      { timestamp: startTime, freeBytes: 50 * GIGABYTE_BYTES, totalBytes },
      { timestamp: startTime + 5 * msPerDay, freeBytes: 40 * GIGABYTE_BYTES, totalBytes }
    ]

    const forecast = calculateHeadroomForecast({
      isPro: true,
      samples,
      currentFreeBytes: 40 * GIGABYTE_BYTES,
      totalBytes,
      alertSettings: { enabled: true, kind: 'gigabytes', value: 10 },
      now: startTime + 5 * msPerDay
    })

    expect(forecast.status).toBe('declining')
    expect(forecast.dailyDeclineBytes).toBeCloseTo(2 * GIGABYTE_BYTES, -5)
    expect(forecast.daysRemaining).toBe(15)
    expect(forecast.thresholdBytes).toBe(thresholdBytes)
    expect(forecast.estimatedDate).toBe(
      new Date(startTime + 5 * msPerDay + 15 * msPerDay).toISOString()
    )
  })
})

describe('mergeIsPro', () => {
  it('normalizes boolean values', () => {
    expect(mergeIsPro(true)).toBe(true)
    expect(mergeIsPro(false)).toBe(false)
    expect(mergeIsPro(undefined)).toBe(false)
    expect(mergeIsPro(null)).toBe(false)
    expect(mergeIsPro('true' as never)).toBe(false)
  })
})
