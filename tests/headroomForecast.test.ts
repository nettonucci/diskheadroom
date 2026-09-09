import { describe, expect, it } from 'vitest'
import {
  DAY_MS,
  DEFAULT_LOW_DISK_ALERT,
  GIGABYTE_BYTES,
  HEADROOM_DISPLAY_MAX_DAYS,
  HEADROOM_MAX_AGE_MS,
  HEADROOM_MAX_SAMPLES,
  HEADROOM_MIN_INTERVAL_MS
} from '../src/shared/constants'
import {
  aggregateCategoryTotals,
  appendDiskSample,
  canRecordSample,
  computeHeadroomForecast,
  gatedForecastStatus,
  lastScanTotals,
  lowDiskThresholdBytes,
  ordinaryLeastSquaresSlope,
  parseHeadroomSamples,
  pruneHeadroomSamples,
  upsertScanSample,
  type HeadroomSample
} from '../src/shared/headroomForecast'

const now = Date.UTC(2026, 8, 9)
const total = 1000 * GIGABYTE_BYTES

function sample(at: number, freeGb: number, categories?: HeadroomSample['categories']): HeadroomSample {
  const row: HeadroomSample = {
    at,
    freeBytes: freeGb * GIGABYTE_BYTES,
    totalBytes: total
  }
  if (categories) row.categories = categories
  return row
}

describe('headroom forecast math', () => {
  it('uses the documented 10% default as a byte threshold', () => {
    expect(lowDiskThresholdBytes(1000, DEFAULT_LOW_DISK_ALERT)).toBe(100)
    expect(lowDiskThresholdBytes(10 * GIGABYTE_BYTES, { kind: 'gigabytes', value: 5 })).toBe(
      5 * GIGABYTE_BYTES
    )
  })

  it('aggregates last-scan totals without paths', () => {
    expect(
      aggregateCategoryTotals([
        { categoryId: 'userCaches', bytes: 10 },
        { categoryId: 'userCaches', bytes: 5 },
        { categoryId: 'trash', bytes: 20 }
      ])
    ).toEqual({
      userCaches: { count: 2, bytes: 15 },
      trash: { count: 1, bytes: 20 }
    })
  })

  it('parses samples and drops paths or junk fields', () => {
    expect(
      parseHeadroomSamples({
        samples: [
          {
            at: now,
            freeBytes: 200,
            totalBytes: 1000,
            path: '/Users/secret',
            categories: {
              userCaches: { count: 2, bytes: 40 },
              '/etc/passwd': { count: 1, bytes: 1 }
            }
          },
          { at: 'nope', freeBytes: 1, totalBytes: 1 }
        ]
      })
    ).toEqual([
      {
        at: now,
        freeBytes: 200,
        totalBytes: 1000,
        categories: { userCaches: { count: 2, bytes: 40 } }
      }
    ])
  })

  it('prunes by age and sample cap', () => {
    const old = sample(now - HEADROOM_MAX_AGE_MS - DAY_MS, 400)
    const kept = Array.from({ length: HEADROOM_MAX_SAMPLES + 5 }, (_, index) =>
      sample(now - (HEADROOM_MAX_SAMPLES + 4 - index) * DAY_MS, 200 - index)
    )
    const pruned = pruneHeadroomSamples([old, ...kept], now)
    expect(pruned).toHaveLength(HEADROOM_MAX_SAMPLES)
    expect(pruned[0]?.at).toBeGreaterThan(old.at)
  })

  it('throttles disk samples to the minimum interval', () => {
    const first = [sample(now, 200)]
    expect(canRecordSample(first, now + HEADROOM_MIN_INTERVAL_MS - 1)).toBe(false)
    expect(canRecordSample(first, now + HEADROOM_MIN_INTERVAL_MS)).toBe(true)
    expect(appendDiskSample(first, sample(now + 1000, 190), now + 1000)).toEqual(first)
  })

  it('merges scan totals into a recent sample instead of growing the file', () => {
    const first = [sample(now, 200)]
    const merged = upsertScanSample(
      first,
      sample(now + 1000, 180, { trash: { count: 1, bytes: 50 } }),
      now + 1000
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]).toEqual({
      at: now,
      freeBytes: 180 * GIGABYTE_BYTES,
      totalBytes: total,
      categories: { trash: { count: 1, bytes: 50 } }
    })
    expect(lastScanTotals(merged)).toEqual({ bytes: 50, groups: 1 })
  })

  it('returns collecting with a single sample', () => {
    expect(computeHeadroomForecast([sample(now, 200)], DEFAULT_LOW_DISK_ALERT, now)).toEqual(
      expect.objectContaining({
        entitled: true,
        kind: 'collecting',
        sampleCount: 1,
        daysUntilThreshold: null
      })
    )
  })

  it('estimates days from a constant decline fixture', () => {
    const samples = [
      sample(now - 10 * DAY_MS, 200),
      sample(now - 5 * DAY_MS, 150),
      sample(now, 120)
    ]
    const forecast = computeHeadroomForecast(samples, DEFAULT_LOW_DISK_ALERT, now)
    expect(forecast.kind).toBe('ready')
    expect(forecast.daysUntilThreshold).toBe(3)
    expect(forecast.daysCapped).toBe(false)
    expect(forecast.predictedAt).toBe(new Date(now + 3 * DAY_MS).toISOString())
  })

  it('reports stable when free space is not declining', () => {
    const samples = [sample(now - 10 * DAY_MS, 100), sample(now, 200)]
    expect(computeHeadroomForecast(samples, DEFAULT_LOW_DISK_ALERT, now).kind).toBe('stable')
  })

  it('returns zero days when already below the threshold', () => {
    const samples = [sample(now - DAY_MS, 80), sample(now, 50)]
    expect(computeHeadroomForecast(samples, DEFAULT_LOW_DISK_ALERT, now)).toEqual(
      expect.objectContaining({ kind: 'below', daysUntilThreshold: 0 })
    )
  })

  it('caps the displayed horizon at 90 days', () => {
    const samples = [sample(now - 10 * DAY_MS, 200.5), sample(now, 200)]
    const forecast = computeHeadroomForecast(samples, DEFAULT_LOW_DISK_ALERT, now)
    expect(forecast.kind).toBe('ready')
    expect(forecast.daysUntilThreshold).toBeGreaterThan(HEADROOM_DISPLAY_MAX_DAYS)
    expect(forecast.daysCapped).toBe(true)
    expect(forecast.predictedAt).toBeNull()
  })

  it('fits a known OLS slope in bytes per millisecond', () => {
    const samples = [sample(now, 100), sample(now + DAY_MS, 90)]
    const slope = ordinaryLeastSquaresSlope(samples)
    expect(slope).toBeCloseTo((-10 * GIGABYTE_BYTES) / DAY_MS, 12)
  })

  it('keeps the gated payload empty', () => {
    expect(gatedForecastStatus()).toEqual({
      entitled: false,
      kind: 'gated',
      sampleCount: 0,
      daysUntilThreshold: null,
      daysCapped: false,
      predictedAt: null,
      lastScan: null
    })
  })
})
