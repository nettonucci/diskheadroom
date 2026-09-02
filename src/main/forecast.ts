import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  MAX_HEADROOM_SAMPLES,
  MAX_HEADROOM_SAMPLE_AGE_MS,
  MIN_HEADROOM_SAMPLE_INTERVAL_MS
} from '../shared/constants'
import {
  calculateHeadroomForecast,
  pruneHeadroomSamples,
  type CalculateForecastOptions
} from '../shared/forecast'
import type { AppSettings, DiskInfo, HeadroomForecast, HeadroomSample } from '../shared/types'

export const getHeadroomSamplesPath = (): string =>
  join(app.getPath('userData'), 'headroom-samples.json')

export async function loadHeadroomSamples(): Promise<HeadroomSample[]> {
  try {
    const raw = await readFile(getHeadroomSamplesPath(), 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return pruneHeadroomSamples(parsed, Date.now())
  } catch {
    return []
  }
}

export async function saveHeadroomSamples(samples: HeadroomSample[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(
    getHeadroomSamplesPath(),
    JSON.stringify(samples, null, 2),
    'utf8'
  )
}

export interface RecordSampleInput {
  freeBytes: number
  totalBytes: number
  junkBytes?: number
  categoryTotals?: Record<string, number>
  timestamp?: number
}

export interface RecordSampleOptions {
  force?: boolean
  now?: number
}

export async function recordHeadroomSample(
  input: RecordSampleInput,
  options: RecordSampleOptions = {}
): Promise<HeadroomSample[]> {
  const now = options.now ?? input.timestamp ?? Date.now()
  const existing = await loadHeadroomSamples()

  const newSample: HeadroomSample = {
    timestamp: now,
    freeBytes: Math.round(input.freeBytes),
    totalBytes: Math.round(input.totalBytes)
  }

  if (typeof input.junkBytes === 'number' && Number.isFinite(input.junkBytes)) {
    newSample.junkBytes = Math.max(0, Math.round(input.junkBytes))
  }

  if (input.categoryTotals && typeof input.categoryTotals === 'object') {
    const totals: Record<string, number> = {}
    for (const [k, v] of Object.entries(input.categoryTotals)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        totals[k] = Math.max(0, Math.round(v))
      }
    }
    if (Object.keys(totals).length > 0) {
      newSample.categoryTotals = totals
    }
  }

  let nextSamples: HeadroomSample[]
  const last = existing.length > 0 ? existing[existing.length - 1] : null

  // If the last sample was taken very recently (< 5 minutes ago) and not forced, update it
  if (
    !options.force &&
    last &&
    Math.abs(now - last.timestamp) < MIN_HEADROOM_SAMPLE_INTERVAL_MS
  ) {
    nextSamples = [...existing.slice(0, -1), newSample]
  } else {
    nextSamples = [...existing, newSample]
  }

  const pruned = pruneHeadroomSamples(
    nextSamples,
    now,
    MAX_HEADROOM_SAMPLES,
    MAX_HEADROOM_SAMPLE_AGE_MS
  )
  await saveHeadroomSamples(pruned)
  return pruned
}

export async function getHeadroomForecast(
  diskOrOptions?: DiskInfo | (Partial<CalculateForecastOptions> & { isPro?: boolean }),
  maybeSettings?: AppSettings,
  now: number = Date.now()
): Promise<HeadroomForecast> {
  const samples = await loadHeadroomSamples()
  if (diskOrOptions && ('isPro' in diskOrOptions || 'currentFreeBytes' in diskOrOptions || 'samples' in diskOrOptions)) {
    const opts = diskOrOptions as Partial<CalculateForecastOptions>
    return calculateHeadroomForecast({
      samples: opts.samples ?? samples,
      currentFreeBytes: opts.currentFreeBytes,
      totalBytes: opts.totalBytes,
      threshold: opts.threshold ?? opts.alertSettings,
      now: opts.now ?? now,
      isPro: opts.isPro
    })
  }

  const disk = diskOrOptions as DiskInfo | undefined
  return calculateHeadroomForecast({
    samples,
    threshold: maybeSettings?.lowDiskAlert,
    currentDisk: disk ? { totalBytes: disk.totalBytes, freeBytes: disk.freeBytes } : null,
    now,
    isPro: maybeSettings?.isPro
  })
}

export async function clearHeadroomSamples(): Promise<void> {
  await saveHeadroomSamples([])
}
