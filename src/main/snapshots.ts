import { app } from 'electron'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { calculateCategoryTotals } from '../shared/deltas'
import type { CategorySnapshot, ScanCategoryId, ScanItem } from '../shared/types'

/**
 * Returns the absolute filesystem path for the local scan snapshot JSON file.
 *
 * @returns Absolute path to scan-snapshots.json in the user data directory.
 */
export function getSnapshotsPath(): string {
  return join(app.getPath('userData'), 'scan-snapshots.json')
}

/**
 * Loads the previous scan snapshot from local disk.
 *
 * @returns The last recorded category snapshot, or null if no snapshot exists.
 */
export async function loadLastSnapshot(): Promise<CategorySnapshot | null> {
  try {
    const raw = await readFile(getSnapshotsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<CategorySnapshot>
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.scannedAt !== 'string' ||
      typeof parsed.totalBytes !== 'number' ||
      !parsed.categories ||
      typeof parsed.categories !== 'object'
    ) {
      return null
    }

    const categories: Partial<Record<ScanCategoryId, number>> = {}
    for (const [key, value] of Object.entries(parsed.categories)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        categories[key as ScanCategoryId] = value
      }
    }

    return {
      scannedAt: parsed.scannedAt,
      totalBytes: Math.max(0, parsed.totalBytes),
      categories
    }
  } catch {
    return null
  }
}

/**
 * Persists a scan snapshot to local disk without any path or file name strings.
 *
 * @param snapshot The category snapshot to write.
 */
export async function saveSnapshot(snapshot: CategorySnapshot): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(getSnapshotsPath(), JSON.stringify(snapshot, null, 2), 'utf8')
}

export interface RecordSnapshotResult {
  current: CategorySnapshot
  previous: CategorySnapshot | null
}

/**
 * Records a successful scan result into local snapshot storage and returns both current and previous snapshots.
 *
 * @param items List of scanned items.
 * @param scannedAt Timestamp of the scan.
 * @returns Object containing the newly created current snapshot and the previous snapshot if present.
 */
export async function recordScanSnapshot(
  items: ScanItem[],
  scannedAt: string
): Promise<RecordSnapshotResult> {
  const previous = await loadLastSnapshot()
  const categories = calculateCategoryTotals(items)
  const totalBytes = items.reduce((sum, item) => sum + (item.bytes > 0 ? item.bytes : 0), 0)

  const current: CategorySnapshot = {
    scannedAt,
    categories,
    totalBytes
  }

  await saveSnapshot(current)
  return { current, previous }
}

/**
 * Removes the local scan snapshot file.
 */
export async function clearSnapshots(): Promise<void> {
  try {
    await unlink(getSnapshotsPath())
  } catch {
  }
}
