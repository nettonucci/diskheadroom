import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SCAN_CATEGORIES, GIGABYTE_BYTES } from '../src/shared/constants'
import { gatedForecastStatus } from '../src/shared/headroomForecast'
import type { AppSettings, ScanItem } from '../src/shared/types'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  getPath: vi.fn(() => '/tmp/diskheadroom'),
  getDiskInfo: vi.fn(),
  loadSettings: vi.fn(),
  getLicenseStatus: vi.fn()
}))

vi.mock('node:fs/promises', () => {
  const module = { readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: mocks.mkdir }
  return { default: module, ...module }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath }
}))

vi.mock('../src/main/disk', () => ({
  getDiskInfo: mocks.getDiskInfo
}))
vi.mock('../src/main/settings', () => ({
  loadSettings: mocks.loadSettings
}))
vi.mock('../src/main/license', () => ({
  getLicenseStatus: mocks.getLicenseStatus
}))

import { getForecastStatus, recordDiskSample, recordScanSample } from '../src/main/headroomForecast'

const settings: AppSettings = {
  unusedDays: 90,
  setupComplete: true,
  preferencesSetupComplete: true,
  resultsTourComplete: true,
  locale: 'en',
  appearance: 'system',
  scanCategories: DEFAULT_SCAN_CATEGORIES,
  largeFileMinBytes: 500 * 1024 * 1024,
  downloadsMinDays: 30,
  downloadsMinBytes: 50 * 1024 * 1024,
  lowDiskAlert: { enabled: false, kind: 'percent', value: 10 },
  launchAtLogin: false,
  scanReminder: { enabled: false, intervalDays: 7 },
  neverTouchPaths: [],
  duplicateFolders: []
}

const items: ScanItem[] = [
  {
    id: 'a',
    categoryId: 'userCaches',
    name: 'Cache A',
    path: '/Users/test/Library/Caches/a',
    bytes: 2048,
    selectedByDefault: true,
    optional: false,
    lastUsedAt: null,
    daysIdle: null
  }
]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
  mocks.getLicenseStatus.mockResolvedValue({ isPro: true })
  mocks.loadSettings.mockResolvedValue(settings)
  mocks.getDiskInfo.mockResolvedValue({
    mount: '/',
    totalBytes: 1000 * GIGABYTE_BYTES,
    freeBytes: 200 * GIGABYTE_BYTES,
    usedBytes: 800 * GIGABYTE_BYTES
  })
})

describe('headroom forecast persistence', () => {
  it('does not write samples without Pro', async () => {
    mocks.getLicenseStatus.mockResolvedValue({ isPro: false })
    await recordDiskSample(1_000)
    await recordScanSample(items, 1_000)
    expect(mocks.writeFile).not.toHaveBeenCalled()
    await expect(getForecastStatus(1_000)).resolves.toEqual(gatedForecastStatus())
  })

  it('records a disk sample and returns collecting until a second point exists', async () => {
    await recordDiskSample(1_000)
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/diskheadroom/headroom-samples.json',
      JSON.stringify({
        samples: [
          {
            at: 1_000,
            freeBytes: 200 * GIGABYTE_BYTES,
            totalBytes: 1000 * GIGABYTE_BYTES
          }
        ]
      }),
      'utf8'
    )
    mocks.readFile.mockResolvedValueOnce(mocks.writeFile.mock.calls[0][1])
    await expect(getForecastStatus(1_000)).resolves.toEqual(
      expect.objectContaining({ entitled: true, kind: 'collecting', sampleCount: 1 })
    )
  })

  it('stores last-scan category totals without paths', async () => {
    await recordScanSample(items, 2_000)
    const payload = JSON.parse(mocks.writeFile.mock.calls[0][1] as string) as {
      samples: Array<{ categories?: unknown; path?: unknown }>
    }
    expect(payload.samples[0]?.categories).toEqual({ userCaches: { count: 1, bytes: 2048 } })
    expect(JSON.stringify(payload)).not.toContain('/Users/test')
  })

  it('skips a second disk sample inside the minimum interval', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        samples: [{ at: 1_000, freeBytes: 200 * GIGABYTE_BYTES, totalBytes: 1000 * GIGABYTE_BYTES }]
      })
    )
    await recordDiskSample(1_000 + 60 * 60 * 1000)
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/diskheadroom/headroom-samples.json',
      JSON.stringify({
        samples: [{ at: 1_000, freeBytes: 200 * GIGABYTE_BYTES, totalBytes: 1000 * GIGABYTE_BYTES }]
      }),
      'utf8'
    )
  })
})
