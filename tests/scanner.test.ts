import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  lstat: vi.fn(),
  readdir: vi.fn(),
  readlink: vi.fn(),
  stat: vi.fn(),
  getPermissionStatus: vi.fn()
}))

vi.mock('node:child_process', () => ({
  default: { execFile: mocks.execFile },
  execFile: mocks.execFile
}))
vi.mock('node:fs/promises', () => {
  const module = {
    lstat: mocks.lstat,
    readdir: mocks.readdir,
    readlink: mocks.readlink,
    stat: mocks.stat
  }
  return { default: module, ...module }
})
vi.mock('node:os', () => ({
  default: { homedir: () => '/Users/test' },
  homedir: () => '/Users/test'
}))
vi.mock('../src/main/permissions', () => ({
  getPermissionStatus: mocks.getPermissionStatus
}))

import { isSafePath, runScan } from '../src/main/scanner'

const directory = {
  isSymbolicLink: () => false,
  isFile: () => false,
  isDirectory: () => true,
  size: 0
}
const file = (size: number) => ({
  isSymbolicLink: () => false,
  isFile: () => true,
  isDirectory: () => false,
  size
})
const symlink = {
  isSymbolicLink: () => true,
  isFile: () => false,
  isDirectory: () => false,
  size: 0
}

function execResult(valueFor: (command: string, args: string[]) => string | Error): void {
  mocks.execFile.mockImplementation((command, args, callback) => {
    const result = valueFor(command, args)
    if (result instanceof Error) callback(result)
    else callback(null, { stdout: result, stderr: '' })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  mocks.getPermissionStatus.mockResolvedValue({
    fullDiskAccess: true,
    libraryCachesReadable: true,
    applicationsReadable: true
  })
  mocks.readlink.mockResolvedValue('/Users/test/target')
  mocks.stat.mockResolvedValue({ mtimeMs: Date.now() - 200 * 86400000 })
})

describe('path safety', () => {
  it.each([
    ['/', false],
    ['/Users/test', false],
    ['/System', false],
    ['/System/Library', false],
    ['/usr/sbin/tool', false],
    ['/bin/zsh', false],
    ['/sbin/foo', false],
    ['/private/var/db/TCC.db', false],
    ['/Users/test/Library/Caches/x', true],
    ['/Applications/Foo.app', true]
  ])('classifies %s', (path, safe) => {
    expect(isSafePath(path)).toBe(safe)
  })
})

describe('runScan', () => {
  it('scans categories, filters unsafe/empty entries and finds idle apps', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    const logs = `${home}/Library/Logs`
    const brew = `${caches}/Homebrew`
    const trash = `${home}/.Trash`
    const derived = `${home}/Library/Developer/Xcode/DerivedData`
    const device = `${home}/Library/Developer/Xcode/iOS DeviceSupport`

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['Homebrew', 'good', 'empty', 'link', 'socket']
      if (path === logs) throw new Error('denied')
      if (path === brew || path === trash || path === derived || path === device) return ['payload']
      if (path === '/Applications') {
        return ['Old.app', 'Recent.app', 'Apple.app', 'Never.app', 'Disk Headroom.app', 'readme.txt']
      }
      if (path === `${home}/Applications`) throw new Error('missing')
      return []
    })

    mocks.lstat.mockImplementation(async (path: string) => {
      if (path.endsWith('/empty')) return file(0)
      if (path.endsWith('/link')) return symlink
      if (path.endsWith('/socket')) {
        return {
          isSymbolicLink: () => false,
          isFile: () => false,
          isDirectory: () => false,
          size: 0
        }
      }
      if (path.endsWith('/payload')) return file(100)
      if (path.endsWith('/good')) return file(200)
      if (path.endsWith('.app')) return file(500)
      return directory
    })

    const old = new Date(Date.now() - 200 * 86400000).toISOString()
    const recent = new Date(Date.now() - 2 * 86400000).toISOString()
    execResult((command, args) => {
      const appPath = args.join(' ')
      if (command === 'defaults') {
        if (appPath.includes('Apple.app')) return 'com.apple.Example\n'
        return 'com.example.App\n'
      }
      if (appPath.includes('Old.app')) return old
      if (appPath.includes('Recent.app')) return recent
      if (appPath.includes('Never.app')) return '(null)'
      return new Error('spotlight unavailable')
    })

    const progress = vi.fn()
    const result = await runScan(90, progress)
    expect(result.limited).toBe(false)
    expect(result.items.map((item) => item.name || item.nameKey)).toEqual([
      'good',
      'category.homebrewCache.title',
      'category.trash.title',
      'category.xcodeDerivedData.title',
      'category.iosDeviceSupport.title',
      'Old',
      'Never'
    ])
    expect(result.items.every((item) => item.bytes > 0)).toBe(true)
    expect(progress).toHaveBeenCalledTimes(7)
    expect(progress).toHaveBeenLastCalledWith({ phase: 'progress.done', percent: 100 })
  })

  it('returns an empty limited result when roots are inaccessible', async () => {
    mocks.getPermissionStatus.mockResolvedValue({
      fullDiskAccess: false,
      libraryCachesReadable: false,
      applicationsReadable: false
    })
    mocks.readdir.mockRejectedValue(new Error('denied'))
    const result = await runScan(30, vi.fn())
    expect(result.items).toEqual([])
    expect(result.limited).toBe(true)
    expect(new Date(result.scannedAt).getTime()).not.toBeNaN()
  })

  it('handles malformed metadata, failed stats and recursive directories', async () => {
    const cacheRoot = '/Users/test/Library/Caches'
    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === cacheRoot) return ['tree']
      if (path.includes('/tree') && path.split('/').filter((part) => part === 'next').length < 30) {
        return ['next']
      }
      if (path === '/Applications') return ['BadDate.app', 'FreshUnknown.app', 'MissingUnknown.app']
      if (path === '/Users/test/Applications') return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path.includes('/tree')) return directory
      if (path.endsWith('BadDate.app')) return file(10)
      if (path.endsWith('FreshUnknown.app')) return file(20)
      if (path.endsWith('MissingUnknown.app')) throw new Error('gone')
      throw new Error('missing')
    })
    mocks.stat
      .mockResolvedValueOnce({ mtimeMs: Date.now() })
      .mockRejectedValueOnce(new Error('gone'))
    execResult((command, args) => {
      if (command === 'defaults' && args.join(' ').includes('BadDate.app')) return new Error('plist')
      if (command === 'mdls' && args.join(' ').includes('BadDate.app')) return 'not-a-date'
      return '(null)'
    })

    const result = await runScan(90, vi.fn())
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ name: 'FreshUnknown', lastUsedAt: null })
  })
})
