import type { ScanCategoryFlags } from './constants'
import type {
  CategoryDelta,
  CategoryDeltaStatus,
  CategorySnapshot,
  ScanCategoryId,
  ScanDeltaSummary,
  ScanItem
} from './types'

/**
 * Calculates byte totals grouped by scan category from a list of scan items.
 *
 * @param items List of scanned items.
 * @returns Map of category IDs to aggregated byte totals.
 */
export function calculateCategoryTotals(
  items: ScanItem[]
): Partial<Record<ScanCategoryId, number>> {
  const totals: Partial<Record<ScanCategoryId, number>> = {}
  for (const item of items) {
    if (typeof item.bytes === 'number' && item.bytes > 0) {
      totals[item.categoryId] = (totals[item.categoryId] ?? 0) + item.bytes
    }
  }
  return totals
}

export interface CalculateScanDeltasOptions {
  current: CategorySnapshot
  previous: CategorySnapshot | null
  isPro: boolean
  scanCategories?: ScanCategoryFlags
}

/**
 * Computes category-level size deltas between current and previous scan snapshots.
 *
 * @param options Current snapshot, previous snapshot, Pro entitlement flag, and active category settings.
 * @returns Aggregated delta summary and category-level comparison records.
 */
export function calculateScanDeltas(options: CalculateScanDeltasOptions): ScanDeltaSummary {
  const { current, previous, isPro, scanCategories } = options

  if (!isPro) {
    return {
      isPro: false,
      hasPreviousScan: previous !== null,
      previousScannedAt: previous?.scannedAt ?? null,
      currentScannedAt: current.scannedAt,
      totalCurrentBytes: current.totalBytes,
      totalPreviousBytes: previous?.totalBytes ?? null,
      totalDeltaBytes: null,
      categories: {}
    }
  }

  const hasPrevious = previous !== null
  const totalPreviousBytes = previous ? previous.totalBytes : null
  const totalDeltaBytes = previous ? current.totalBytes - previous.totalBytes : null

  const allCategoryIds = new Set<ScanCategoryId>([
    ...(Object.keys(current.categories) as ScanCategoryId[]),
    ...(previous ? (Object.keys(previous.categories) as ScanCategoryId[]) : [])
  ])

  const categories: Partial<Record<ScanCategoryId, CategoryDelta>> = {}

  for (const categoryId of allCategoryIds) {
    const currentBytes = current.categories[categoryId] ?? 0
    const prevVal = previous?.categories[categoryId]
    const previousBytes = typeof prevVal === 'number' ? prevVal : null

    if (scanCategories && scanCategories[categoryId as keyof ScanCategoryFlags] === false) {
      categories[categoryId] = {
        categoryId,
        currentBytes,
        previousBytes,
        deltaBytes: null,
        status: 'disabled'
      }
    } else if (!hasPrevious || previousBytes === null) {
      categories[categoryId] = {
        categoryId,
        currentBytes,
        previousBytes: null,
        deltaBytes: null,
        status: 'new'
      }
    } else {
      const delta = currentBytes - previousBytes
      const status: CategoryDeltaStatus = delta > 0 ? 'grew' : delta < 0 ? 'shrank' : 'same'
      categories[categoryId] = {
        categoryId,
        currentBytes,
        previousBytes,
        deltaBytes: delta,
        status
      }
    }
  }

  return {
    isPro: true,
    hasPreviousScan: hasPrevious,
    previousScannedAt: previous ? previous.scannedAt : null,
    currentScannedAt: current.scannedAt,
    totalCurrentBytes: current.totalBytes,
    totalPreviousBytes,
    totalDeltaBytes,
    categories
  }
}
