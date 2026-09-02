import { describe, expect, it } from 'vitest'
import { calculateCategoryTotals, calculateScanDeltas } from '../src/shared/deltas'
import { CategorySnapshot, ScanItem } from '../src/shared/types'
import { DEFAULT_SCAN_CATEGORIES } from '../src/shared/constants'

describe('calculateCategoryTotals', () => {
  it('sums bytes grouped by categoryId', () => {
    const items: ScanItem[] = [
      {
        id: '1',
        categoryId: 'userCaches',
        name: 'Cache 1',
        path: '/path/1',
        bytes: 500,
        selectedByDefault: true,
        optional: false,
        lastUsedAt: null,
        daysIdle: null
      },
      {
        id: '2',
        categoryId: 'userCaches',
        name: 'Cache 2',
        path: '/path/2',
        bytes: 300,
        selectedByDefault: true,
        optional: false,
        lastUsedAt: null,
        daysIdle: null
      },
      {
        id: '3',
        categoryId: 'unusedApps',
        name: 'App 1',
        path: '/path/3',
        bytes: 1200,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: null,
        daysIdle: null
      }
    ]

    const totals = calculateCategoryTotals(items)
    expect(totals.userCaches).toBe(800)
    expect(totals.unusedApps).toBe(1200)
    expect(totals.systemLogs).toBeUndefined()
  })

  it('handles empty items array', () => {
    const totals = calculateCategoryTotals([])
    expect(totals).toEqual({})
  })
})

describe('calculateScanDeltas', () => {
  const currentSnapshot: CategorySnapshot = {
    scannedAt: '2025-01-02T10:00:00.000Z',
    totalBytes: 5000,
    categories: {
      userCaches: 2000,
      unusedApps: 1500,
      systemLogs: 500,
      trash: 1000
    }
  }

  const previousSnapshot: CategorySnapshot = {
    scannedAt: '2025-01-01T10:00:00.000Z',
    totalBytes: 4000,
    categories: {
      userCaches: 1200,
      unusedApps: 1800,
      systemLogs: 500,
      developerXcode: 500
    }
  }

  it('returns non-pro summary when isPro is false', () => {
    const summary = calculateScanDeltas({
      current: currentSnapshot,
      previous: previousSnapshot,
      isPro: false,
      scanCategories: DEFAULT_SCAN_CATEGORIES
    })

    expect(summary.isPro).toBe(false)
    expect(summary.hasPreviousScan).toBe(true)
    expect(summary.totalDeltaBytes).toBeNull()
    expect(summary.previousScannedAt).toBe('2025-01-01T10:00:00.000Z')
    expect(summary.currentScannedAt).toBe('2025-01-02T10:00:00.000Z')
    expect(summary.categories).toEqual({})
  })

  it('handles first scan when previous snapshot is null', () => {
    const summary = calculateScanDeltas({
      current: currentSnapshot,
      previous: null,
      isPro: true,
      scanCategories: DEFAULT_SCAN_CATEGORIES
    })

    expect(summary.isPro).toBe(true)
    expect(summary.hasPreviousScan).toBe(false)
    expect(summary.previousScannedAt).toBeNull()
    expect(summary.currentScannedAt).toBe('2025-01-02T10:00:00.000Z')
    expect(summary.totalDeltaBytes).toBeNull()
    expect(summary.categories.userCaches?.status).toBe('new')
    expect(summary.categories.userCaches?.currentBytes).toBe(2000)
    expect(summary.categories.userCaches?.previousBytes).toBeNull()
    expect(summary.categories.userCaches?.deltaBytes).toBeNull()
  })

  it('correctly categorizes grew, shrank, same, new, and disabled categories on second scan', () => {
    const scanCategories = {
      ...DEFAULT_SCAN_CATEGORIES,
      trash: false
    }

    const summary = calculateScanDeltas({
      current: currentSnapshot,
      previous: previousSnapshot,
      isPro: true,
      scanCategories
    })

    expect(summary.isPro).toBe(true)
    expect(summary.hasPreviousScan).toBe(true)
    expect(summary.previousScannedAt).toBe('2025-01-01T10:00:00.000Z')
    expect(summary.currentScannedAt).toBe('2025-01-02T10:00:00.000Z')
    expect(summary.totalDeltaBytes).toBe(1000)

    const userCaches = summary.categories.userCaches
    expect(userCaches?.status).toBe('grew')
    expect(userCaches?.currentBytes).toBe(2000)
    expect(userCaches?.previousBytes).toBe(1200)
    expect(userCaches?.deltaBytes).toBe(800)

    const unusedApps = summary.categories.unusedApps
    expect(unusedApps?.status).toBe('shrank')
    expect(unusedApps?.currentBytes).toBe(1500)
    expect(unusedApps?.previousBytes).toBe(1800)
    expect(unusedApps?.deltaBytes).toBe(-300)

    const systemLogs = summary.categories.systemLogs
    expect(systemLogs?.status).toBe('same')
    expect(systemLogs?.currentBytes).toBe(500)
    expect(systemLogs?.previousBytes).toBe(500)
    expect(systemLogs?.deltaBytes).toBe(0)

    const trash = summary.categories.trash
    expect(trash?.status).toBe('disabled')
    expect(trash?.currentBytes).toBe(1000)
    expect(trash?.previousBytes).toBeNull()
    expect(trash?.deltaBytes).toBeNull()
  })
})
