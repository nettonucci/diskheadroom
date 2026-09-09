import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mergeLowDiskAlert } from '../shared/constants'
import { isProEntitled } from '../shared/entitlement'
import {
  aggregateCategoryTotals,
  appendDiskSample,
  computeHeadroomForecast,
  gatedForecastStatus,
  parseHeadroomSamples,
  pruneHeadroomSamples,
  upsertScanSample,
  type HeadroomForecastStatus,
  type HeadroomSample
} from '../shared/headroomForecast'
import type { ScanItem } from '../shared/types'
import { getDiskInfo } from './disk'
import { getLicenseStatus } from './license'
import { loadSettings } from './settings'

const statePath = (): string => join(app.getPath('userData'), 'headroom-samples.json')

async function loadSamples(): Promise<HeadroomSample[]> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as unknown
    return parseHeadroomSamples(parsed)
  } catch {
    return []
  }
}

async function saveSamples(samples: HeadroomSample[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(statePath(), JSON.stringify({ samples }), 'utf8')
}

async function entitled(): Promise<boolean> {
  return isProEntitled((await getLicenseStatus()).isPro)
}

async function snapshotDisk(now: number): Promise<HeadroomSample | null> {
  const disk = await getDiskInfo()
  if (!Number.isFinite(disk.freeBytes) || !Number.isFinite(disk.totalBytes) || disk.totalBytes <= 0) {
    return null
  }
  return { at: now, freeBytes: disk.freeBytes, totalBytes: disk.totalBytes }
}

export async function recordDiskSample(now = Date.now()): Promise<void> {
  if (!(await entitled())) return
  const next = await snapshotDisk(now)
  if (!next) return
  const samples = pruneHeadroomSamples(await loadSamples(), now)
  await saveSamples(appendDiskSample(samples, next, now))
}

export async function recordScanSample(items: ScanItem[], now = Date.now()): Promise<void> {
  if (!(await entitled())) return
  const next = await snapshotDisk(now)
  if (!next) return
  const categories = aggregateCategoryTotals(items)
  if (Object.keys(categories).length > 0) next.categories = categories
  const samples = pruneHeadroomSamples(await loadSamples(), now)
  await saveSamples(upsertScanSample(samples, next, now))
}

export async function getForecastStatus(now = Date.now()): Promise<HeadroomForecastStatus> {
  if (!(await entitled())) return gatedForecastStatus()
  const settings = await loadSettings()
  const samples = pruneHeadroomSamples(await loadSamples(), now)
  return computeHeadroomForecast(samples, mergeLowDiskAlert(settings.lowDiskAlert), now)
}
