import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn()
}))

vi.mock('node:fs/promises', () => {
  const module = {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
    unlink: mocks.unlink
  }
  return { default: module, ...module }
})

vi.mock('electron', () => ({
  app: {
    getPath: () => '/mock/userData'
  }
}))

import {
  clearSnapshots,
  getSnapshotsPath,
  loadLastSnapshot,
  recordScanSnapshot,
  saveSnapshot
} from '../src/main/snapshots'
import { ScanItem } from '../src/shared/types'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('snapshots main persistence', () => {
  it('returns correct snapshots path in userData', () => {
    expect(getSnapshotsPath()).toBe('/mock/userData/scan-snapshots.json')
  })

  it('returns null when snapshot file does not exist', async () => {
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    const snapshot = await loadLastSnapshot()
    expect(snapshot).toBeNull()
  })

  it('parses valid snapshot json from disk', async () => {
    const raw = {
      scannedAt: '2025-01-01T00:00:00.000Z',
      totalBytes: 2500,
      categories: {
        userCaches: 1500,
        unusedApps: 1000
      }
    }
    mocks.readFile.mockResolvedValue(JSON.stringify(raw))
    const snapshot = await loadLastSnapshot()
    expect(snapshot).toEqual(raw)
  })

  it('returns null on malformed json', async () => {
    mocks.readFile.mockResolvedValue('invalid-json')
    const snapshot = await loadLastSnapshot()
    expect(snapshot).toBeNull()
  })

  it('saves snapshot to disk and ensures no file paths or names are stored', async () => {
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)

    const snapshot = {
      scannedAt: '2025-01-02T12:00:00.000Z',
      totalBytes: 3000,
      categories: {
        userCaches: 2000,
        trash: 1000
      }
    }

    await saveSnapshot(snapshot)

    expect(mocks.mkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
    expect(mocks.writeFile).toHaveBeenCalledTimes(1)

    const [writtenPath, writtenContent, writtenEncoding] = mocks.writeFile.mock.calls[0]
    expect(writtenPath).toBe('/mock/userData/scan-snapshots.json')
    expect(writtenEncoding).toBe('utf8')

    const parsed = JSON.parse(writtenContent as string)
    expect(parsed).toEqual(snapshot)
    expect(parsed).not.toHaveProperty('path')
    expect(parsed).not.toHaveProperty('name')
    expect(parsed).not.toHaveProperty('items')
    expect(writtenContent).not.toContain('/Users/')
    expect(writtenContent).not.toContain('.app')
  })

  it('clears snapshots file cleanly', async () => {
    mocks.unlink.mockResolvedValue(undefined)
    await clearSnapshots()
    expect(mocks.unlink).toHaveBeenCalledWith('/mock/userData/scan-snapshots.json')
  })

  it('records scan snapshot and aggregates only category byte totals', async () => {
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    mocks.mkdir.mockResolvedValue(undefined)
    mocks.writeFile.mockResolvedValue(undefined)

    const items: ScanItem[] = [
      {
        id: '1',
        categoryId: 'userCaches',
        name: 'Secret Cache',
        path: '/Users/private/Library/Caches/secret',
        bytes: 1024,
        selectedByDefault: true,
        optional: false,
        lastUsedAt: null,
        daysIdle: null
      },
      {
        id: '2',
        categoryId: 'userCaches',
        name: 'Another Cache',
        path: '/Users/private/Library/Caches/another',
        bytes: 2048,
        selectedByDefault: true,
        optional: false,
        lastUsedAt: null,
        daysIdle: null
      },
      {
        id: '3',
        categoryId: 'unusedApps',
        name: 'Personal App',
        path: '/Applications/Personal.app',
        bytes: 4096,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: null,
        daysIdle: null
      }
    ]

    const result = await recordScanSnapshot(items, '2025-01-01T00:00:00.000Z')

    expect(result.previous).toBeNull()
    expect(result.current.totalBytes).toBe(7168)
    expect(result.current.categories.userCaches).toBe(3072)
    expect(result.current.categories.unusedApps).toBe(4096)

    const writtenJson = mocks.writeFile.mock.calls[0][1] as string
    expect(writtenJson).not.toContain('Secret Cache')
    expect(writtenJson).not.toContain('/Users/private')
    expect(writtenJson).not.toContain('Personal.app')
  })
})
