import {
  DAY_MS,
  GIGABYTE_BYTES,
  HEADROOM_DISPLAY_MAX_DAYS,
  HEADROOM_MAX_AGE_MS,
  HEADROOM_MAX_SAMPLES,
  HEADROOM_MIN_INTERVAL_MS,
  type LowDiskAlertSettings
} from './constants'
import type { ScanCategoryId, ScanItem } from './types'

export interface HeadroomCategoryTotal {
  count: number
  bytes: number
}

export type HeadroomCategoryTotals = Partial<Record<ScanCategoryId, HeadroomCategoryTotal>>

export interface HeadroomSample {
  at: number
  freeBytes: number
  totalBytes: number
  categories?: HeadroomCategoryTotals
}

export type HeadroomForecastKind = 'gated' | 'collecting' | 'stable' | 'below' | 'ready'

export interface HeadroomLastScanTotals {
  bytes: number
  groups: number
}

export interface HeadroomForecastStatus {
  entitled: boolean
  kind: HeadroomForecastKind
  sampleCount: number
  daysUntilThreshold: number | null
  daysCapped: boolean
  predictedAt: string | null
  lastScan: HeadroomLastScanTotals | null
}

export function gatedForecastStatus(): HeadroomForecastStatus {
  return {
    entitled: false,
    kind: 'gated',
    sampleCount: 0,
    daysUntilThreshold: null,
    daysCapped: false,
    predictedAt: null,
    lastScan: null
  }
}

export function lowDiskThresholdBytes(
  totalBytes: number,
  alert: Pick<LowDiskAlertSettings, 'kind' | 'value'>
): number {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return 0
  if (alert.kind === 'percent') return (totalBytes * alert.value) / 100
  return alert.value * GIGABYTE_BYTES
}

export function aggregateCategoryTotals(items: readonly Pick<ScanItem, 'categoryId' | 'bytes'>[]): HeadroomCategoryTotals {
  const next: HeadroomCategoryTotals = {}
  for (const item of items) {
    if (!Number.isFinite(item.bytes) || item.bytes < 0) continue
    const current = next[item.categoryId] ?? { count: 0, bytes: 0 }
    current.count += 1
    current.bytes += item.bytes
    next[item.categoryId] = current
  }
  return next
}

export function parseHeadroomSamples(input: unknown): HeadroomSample[] {
  if (!input || typeof input !== 'object') return []
  const raw = (input as { samples?: unknown }).samples
  if (!Array.isArray(raw)) return []
  const samples: HeadroomSample[] = []
  for (const item of raw) {
    const parsed = parseSample(item)
    if (parsed) samples.push(parsed)
  }
  return samples
}

export function pruneHeadroomSamples(samples: HeadroomSample[], now: number): HeadroomSample[] {
  const oldest = now - HEADROOM_MAX_AGE_MS
  const kept = samples
    .filter((sample) => sample.at >= oldest && sample.at <= now + DAY_MS)
    .sort((a, b) => a.at - b.at)
  if (kept.length <= HEADROOM_MAX_SAMPLES) return kept
  return kept.slice(kept.length - HEADROOM_MAX_SAMPLES)
}

export function canRecordSample(samples: HeadroomSample[], now: number): boolean {
  const last = samples[samples.length - 1]
  if (!last) return true
  return now - last.at >= HEADROOM_MIN_INTERVAL_MS
}

export function appendDiskSample(
  samples: HeadroomSample[],
  next: HeadroomSample,
  now: number
): HeadroomSample[] {
  if (!canRecordSample(samples, now)) return pruneHeadroomSamples(samples, now)
  return pruneHeadroomSamples([...samples, next], now)
}

export function upsertScanSample(
  samples: HeadroomSample[],
  next: HeadroomSample,
  now: number
): HeadroomSample[] {
  const last = samples[samples.length - 1]
  if (last && now - last.at < HEADROOM_MIN_INTERVAL_MS) {
    const merged: HeadroomSample = {
      ...last,
      freeBytes: next.freeBytes,
      totalBytes: next.totalBytes,
      categories: next.categories
    }
    return pruneHeadroomSamples([...samples.slice(0, -1), merged], now)
  }
  return pruneHeadroomSamples([...samples, next], now)
}

export function lastScanTotals(samples: HeadroomSample[]): HeadroomLastScanTotals | null {
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const categories = samples[index]?.categories
    if (!categories) continue
    const groups = Object.values(categories)
    if (groups.length === 0) continue
    return {
      groups: groups.length,
      bytes: groups.reduce((sum, item) => sum + item.bytes, 0)
    }
  }
  return null
}

export function ordinaryLeastSquaresSlope(samples: HeadroomSample[]): number | null {
  if (samples.length < 2) return null
  const origin = samples[0].at
  const xs = samples.map((sample) => sample.at - origin)
  const ys = samples.map((sample) => sample.freeBytes)
  const n = samples.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]
    sumY += ys[i]
    sumXY += xs[i] * ys[i]
    sumXX += xs[i] * xs[i]
  }
  const denominator = n * sumXX - sumX * sumX
  if (denominator === 0) return null
  return (n * sumXY - sumX * sumY) / denominator
}

export function computeHeadroomForecast(
  samples: HeadroomSample[],
  alert: Pick<LowDiskAlertSettings, 'kind' | 'value'>,
  now: number
): HeadroomForecastStatus {
  const pruned = pruneHeadroomSamples(samples, now)
  const lastScan = lastScanTotals(pruned)
  const base = {
    entitled: true,
    sampleCount: pruned.length,
    lastScan
  }
  if (pruned.length < 2) {
    return {
      ...gatedForecastStatus(),
      ...base,
      kind: 'collecting'
    }
  }

  const latest = pruned[pruned.length - 1]
  const threshold = lowDiskThresholdBytes(latest.totalBytes, alert)
  if (latest.freeBytes < threshold) {
    return {
      ...base,
      kind: 'below',
      daysUntilThreshold: 0,
      daysCapped: false,
      predictedAt: null
    }
  }

  const slope = ordinaryLeastSquaresSlope(pruned)
  if (slope == null || slope >= 0) {
    return {
      ...base,
      kind: 'stable',
      daysUntilThreshold: null,
      daysCapped: false,
      predictedAt: null
    }
  }

  const msUntil = (latest.freeBytes - threshold) / -slope
  if (!Number.isFinite(msUntil) || msUntil <= 0) {
    return {
      ...base,
      kind: 'below',
      daysUntilThreshold: 0,
      daysCapped: false,
      predictedAt: null
    }
  }

  const days = Math.max(1, Math.ceil(msUntil / DAY_MS))
  const daysCapped = days > HEADROOM_DISPLAY_MAX_DAYS
  return {
    ...base,
    kind: 'ready',
    daysUntilThreshold: days,
    daysCapped,
    predictedAt: daysCapped ? null : new Date(now + days * DAY_MS).toISOString()
  }
}

function parseSample(input: unknown): HeadroomSample | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Partial<HeadroomSample>
  if (!Number.isFinite(raw.at) || (raw.at as number) <= 0) return null
  if (!Number.isFinite(raw.freeBytes) || (raw.freeBytes as number) < 0) return null
  if (!Number.isFinite(raw.totalBytes) || (raw.totalBytes as number) <= 0) return null
  const sample: HeadroomSample = {
    at: raw.at as number,
    freeBytes: raw.freeBytes as number,
    totalBytes: raw.totalBytes as number
  }
  const categories = parseCategories(raw.categories)
  if (categories) sample.categories = categories
  return sample
}

function parseCategories(input: unknown): HeadroomCategoryTotals | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const next: HeadroomCategoryTotals = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isSafeCategoryId(key)) continue
    if (!value || typeof value !== 'object') continue
    const row = value as { count?: unknown; bytes?: unknown }
    if (typeof row.count !== 'number' || !Number.isFinite(row.count) || row.count < 0) continue
    if (typeof row.bytes !== 'number' || !Number.isFinite(row.bytes) || row.bytes < 0) continue
    next[key as ScanCategoryId] = { count: Math.round(row.count), bytes: row.bytes }
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function isSafeCategoryId(key: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9]*$/.test(key) && key.length <= 40
}
