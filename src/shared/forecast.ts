import {
  DAY_MS,
  DEFAULT_LOW_DISK_ALERT,
  GIGABYTE_BYTES,
  MAX_HEADROOM_SAMPLES,
  MAX_HEADROOM_SAMPLE_AGE_MS,
  type LowDiskAlertSettings
} from './constants'
import type { DiskInfo, HeadroomForecast, HeadroomSample } from './types'

export function calculateThresholdBytes(
  totalBytes: number,
  threshold?: LowDiskAlertSettings | null
): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0
  const alert = threshold && threshold.enabled ? threshold : DEFAULT_LOW_DISK_ALERT
  if (alert.kind === 'percent') {
    return Math.round((totalBytes * alert.value) / 100)
  }
  return alert.value * GIGABYTE_BYTES
}

/**
 * Calculates the slope of free disk space over time (in bytes per millisecond)
 * using linear least-squares regression.
 */
export function calculateSlope(
  samples: ReadonlyArray<HeadroomSample | [number, number]>
): { slopeBytesPerMs: number } | null {
  if (samples.length < 2) return null

  let sumX = 0
  let sumY = 0
  const n = samples.length

  for (let i = 0; i < n; i++) {
    const s = samples[i]
    const x = Array.isArray(s) ? s[0] : s.timestamp
    const y = Array.isArray(s) ? s[1] : s.freeBytes
    sumX += x
    sumY += y
  }

  const meanX = sumX / n
  const meanY = sumY / n

  let sxx = 0
  let sxy = 0

  for (let i = 0; i < n; i++) {
    const s = samples[i]
    const x = Array.isArray(s) ? s[0] : s.timestamp
    const y = Array.isArray(s) ? s[1] : s.freeBytes
    const dx = x - meanX
    const dy = y - meanY
    sxx += dx * dx
    sxy += dx * dy
  }

  if (sxx === 0) return null

  return {
    slopeBytesPerMs: sxy / sxx
  }
}

/**
 * Prunes headroom samples to enforce retention age and maximum count caps.
 * Sanitizes entries to ensure only numeric byte/count data is kept.
 */
export function pruneHeadroomSamples(
  samples: ReadonlyArray<HeadroomSample>,
  now: number,
  maxSamples: number = MAX_HEADROOM_SAMPLES,
  maxAgeMs: number = MAX_HEADROOM_SAMPLE_AGE_MS
): HeadroomSample[] {
  const minTimestamp = now - maxAgeMs

  const sanitized: HeadroomSample[] = []
  for (const item of samples) {
    if (!item || typeof item !== 'object') continue
    if (
      typeof item.timestamp !== 'number' ||
      !Number.isFinite(item.timestamp) ||
      item.timestamp < minTimestamp ||
      item.timestamp > now + 60_000 // allow slight clock skew
    ) {
      continue
    }
    if (
      typeof item.freeBytes !== 'number' ||
      !Number.isFinite(item.freeBytes) ||
      item.freeBytes < 0
    ) {
      continue
    }
    if (
      typeof item.totalBytes !== 'number' ||
      !Number.isFinite(item.totalBytes) ||
      item.totalBytes <= 0
    ) {
      continue
    }

    const cleaned: HeadroomSample = {
      timestamp: Math.round(item.timestamp),
      freeBytes: Math.round(item.freeBytes),
      totalBytes: Math.round(item.totalBytes)
    }

    if (typeof item.junkBytes === 'number' && Number.isFinite(item.junkBytes)) {
      cleaned.junkBytes = Math.max(0, Math.round(item.junkBytes))
    }

    if (item.categoryTotals && typeof item.categoryTotals === 'object') {
      const totals: Record<string, number> = {}
      for (const [k, v] of Object.entries(item.categoryTotals)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          totals[k] = Math.max(0, Math.round(v))
        }
      }
      if (Object.keys(totals).length > 0) {
        cleaned.categoryTotals = totals
      }
    }

    sanitized.push(cleaned)
  }

  sanitized.sort((a, b) => a.timestamp - b.timestamp)

  if (sanitized.length > maxSamples) {
    return sanitized.slice(-maxSamples)
  }

  return sanitized
}

export interface CalculateForecastOptions {
  samples: ReadonlyArray<HeadroomSample>
  threshold?: LowDiskAlertSettings | null
  alertSettings?: LowDiskAlertSettings | null
  currentDisk?: Pick<DiskInfo, 'totalBytes' | 'freeBytes'> | null
  currentFreeBytes?: number
  totalBytes?: number
  now?: number
  isPro?: boolean
}

/** Minimum timespan between oldest and newest sample to calculate a trend (1 hour). */
export const MIN_FORECAST_SPAN_MS = 60 * 60 * 1000

/** Free space decline threshold below which storage is considered steady (1 MB / day). */
export const STEADY_DECLINE_THRESHOLD_BYTES_PER_DAY = 1024 * 1024

export function calculateHeadroomForecast(options: CalculateForecastOptions): HeadroomForecast {
  const isProActive = Boolean(options.isPro)
  const now = options.now ?? Date.now()
  const pruned = pruneHeadroomSamples(options.samples, now)

  const sampleCount = pruned.length
  const oldestSampleAt = sampleCount > 0 ? pruned[0].timestamp : null
  const latestSampleAt = sampleCount > 0 ? pruned[sampleCount - 1].timestamp : null

  const latestSample = sampleCount > 0 ? pruned[sampleCount - 1] : null
  const currentFreeBytes =
    options.currentFreeBytes ?? options.currentDisk?.freeBytes ?? latestSample?.freeBytes ?? 0
  const currentTotalBytes =
    options.totalBytes ?? options.currentDisk?.totalBytes ?? latestSample?.totalBytes ?? 0
  const thresholdSetting = options.threshold ?? options.alertSettings
  const thresholdBytes = calculateThresholdBytes(currentTotalBytes, thresholdSetting)

  if (!isProActive) {
    return {
      status: 'gated',
      daysRemaining: null,
      estimatedDate: null,
      dailyDeclineBytes: 0,
      currentFreeBytes,
      thresholdBytes,
      sampleCount,
      oldestSampleAt,
      latestSampleAt
    }
  }

  // If currently at or below low-disk threshold: critical
  if (currentTotalBytes > 0 && currentFreeBytes <= thresholdBytes) {
    return {
      status: 'critical',
      daysRemaining: 0,
      estimatedDate: new Date(now).toISOString(),
      dailyDeclineBytes: 0,
      currentFreeBytes,
      thresholdBytes,
      sampleCount,
      oldestSampleAt,
      latestSampleAt
    }
  }

  // Need at least 2 samples and a non-zero time span
  if (
    sampleCount < 2 ||
    !oldestSampleAt ||
    !latestSampleAt ||
    latestSampleAt <= oldestSampleAt
  ) {
    return {
      status: 'insufficient_data',
      daysRemaining: null,
      estimatedDate: null,
      dailyDeclineBytes: 0,
      currentFreeBytes,
      thresholdBytes,
      sampleCount,
      oldestSampleAt,
      latestSampleAt
    }
  }

  const slope = calculateSlope(pruned)
  if (!slope) {
    return {
      status: 'insufficient_data',
      daysRemaining: null,
      estimatedDate: null,
      dailyDeclineBytes: 0,
      currentFreeBytes,
      thresholdBytes,
      sampleCount,
      oldestSampleAt,
      latestSampleAt
    }
  }

  // slopeBytesPerMs is positive when free space increases, negative when free space decreases
  const dailyChangeBytes = slope.slopeBytesPerMs * DAY_MS

  // If daily change is flat or growing (or decline is negligible < 1MB/day)
  if (dailyChangeBytes >= -STEADY_DECLINE_THRESHOLD_BYTES_PER_DAY) {
    return {
      status: 'steady',
      daysRemaining: null,
      estimatedDate: null,
      dailyDeclineBytes: Math.max(0, -dailyChangeBytes),
      currentFreeBytes,
      thresholdBytes,
      sampleCount,
      oldestSampleAt,
      latestSampleAt
    }
  }

  // Free space is declining
  const dailyDeclineBytes = -dailyChangeBytes
  const bytesUntilThreshold = Math.max(0, currentFreeBytes - thresholdBytes)
  const exactDays = bytesUntilThreshold / dailyDeclineBytes
  const daysRemaining = Math.max(1, Math.round(exactDays))
  const estimatedTimestamp = now + exactDays * DAY_MS
  const estimatedDate = new Date(estimatedTimestamp).toISOString()

  return {
    status: 'declining',
    daysRemaining,
    estimatedDate,
    dailyDeclineBytes: Math.round(dailyDeclineBytes),
    currentFreeBytes,
    thresholdBytes,
    sampleCount,
    oldestSampleAt,
    latestSampleAt
  }
}

