import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixturesDir = join(__dirname, 'fixtures')

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8')
}

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  getDiskInfo: vi.fn()
}))

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
  default: {
    execFile: mocks.execFile
  }
}))

vi.mock('../src/main/disk', () => ({
  getDiskInfo: mocks.getDiskInfo,
  default: {
    getDiskInfo: mocks.getDiskInfo
  }
}))

import { getApfsExplanation } from '../src/main/apfs'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getApfsExplanation', () => {
  it('aggregates container and snapshot details when diskutil commands succeed', async () => {
    mocks.getDiskInfo.mockResolvedValue({
      mount: '/',
      filesystem: '/dev/disk3s1s1',
      totalBytes: 1995218165760,
      usedBytes: 934960513024,
      freeBytes: 1060257652736
    })

    const apfsListPlist = readFixture('diskutil_apfs_list.plist')
    const snapshotsPlist = readFixture('diskutil_snapshots.plist')

    mocks.execFile.mockImplementation((_file: string, args: string[], ...rest: unknown[]) => {
      const callback = rest.find((arg): arg is (err: unknown, stdout: string, stderr: string) => void => typeof arg === 'function')
      if (!callback) return
      if (args.includes('listSnapshots')) {
        callback(null, snapshotsPlist, '')
      } else if (args.includes('list')) {
        callback(null, apfsListPlist, '')
      } else {
        callback(null, '', '')
      }
    })

    const explanation = await getApfsExplanation()

    expect(explanation.containerSize).toBe(1995218165760)
    expect(explanation.containerFree).toBe(1060257652736)
    expect(explanation.breakdown.systemBytes).toBe(18459258880 + 16181239808 + 2349404160)
    expect(explanation.breakdown.dataBytes).toBe(889361747968)
    expect(explanation.snapshotCount).toBe(3)
    expect(explanation.snapshots).toHaveLength(3)
  })

  it('falls back gracefully when diskutil commands fail or reject', async () => {
    mocks.getDiskInfo.mockResolvedValue({
      mount: '/',
      filesystem: '/dev/disk3s1s1',
      totalBytes: 500000000000,
      usedBytes: 300000000000,
      freeBytes: 200000000000
    })

    mocks.execFile.mockImplementation((_file: string, _args: string[], ...rest: unknown[]) => {
      const callback = rest.find((arg): arg is (err: unknown, stdout: string, stderr: string) => void => typeof arg === 'function')
      if (callback) {
        callback(new Error('Command not found'), '', '')
      }
    })

    const explanation = await getApfsExplanation()

    expect(explanation.containerSize).toBe(500000000000)
    expect(explanation.containerFree).toBe(200000000000)
    expect(explanation.purgeableBytes).toBe(0)
    expect(explanation.snapshotCount).toBe(0)
    expect(explanation.snapshots).toEqual([])
  })
})
