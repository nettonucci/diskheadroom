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
  mocks.execFile.mockImplementation((_command, _args, callback) => {
    callback(new Error('unavailable'))
  })
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
    ['/Applications/Foo.app', true],
    ['/Users/test/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw', true],
    ['/Users/test/.docker/buildx', true]
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
    const archives = `${home}/Library/Developer/Xcode/Archives`
    const simCaches = `${home}/Library/Developer/CoreSimulator/Caches`

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['Homebrew', 'good', 'empty', 'link', 'socket']
      if (path === logs) throw new Error('denied')
      if (path === brew || path === trash || path === derived || path === device) return ['payload']
      if (path === archives || path === simCaches) return []
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
    expect(progress).toHaveBeenCalledTimes(9)
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.packageManagers', percent: 44 })
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.docker', percent: 72 })
    expect(progress).toHaveBeenLastCalledWith({ phase: 'progress.done', percent: 100 })
  })

  it('scans Xcode Archives, CoreSimulator caches and unavailable simulators as opt-in', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    const archives = `${home}/Library/Developer/Xcode/Archives`
    const simCaches = `${home}/Library/Developer/CoreSimulator/Caches`
    const developer = `${home}/Library/Developer`
    const devicesRoot = `${home}/Library/Developer/CoreSimulator/Devices`
    const availableUdid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const unavailableUdid = '11111111-2222-3333-4444-555555555555'
    const duplicateUdid = unavailableUdid
    const missingUdid = '99999999-8888-7777-6666-555555555555'
    const unavailablePath = `${devicesRoot}/${unavailableUdid}`
    const availablePath = `${devicesRoot}/${availableUdid}`
    const missingPath = `${devicesRoot}/${missingUdid}`

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['good']
      if (path === archives || path === simCaches || path === unavailablePath) return ['payload']
      if (path === '/Applications' || path === `${home}/Applications`) return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path === missingPath) throw new Error('missing')
      if (path.endsWith('/payload') || path.endsWith('/good')) return file(200)
      return directory
    })
    execResult((command, args) => {
      if (command === 'xcrun' && args.includes('simctl')) {
        return JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-16-0': [
              { udid: unavailableUdid, name: 'iPhone 14', isAvailable: false },
              { udid: duplicateUdid, name: 'iPhone 14 copy', isAvailable: false },
              { udid: availableUdid, name: 'iPhone 15', isAvailable: true },
              { udid: missingUdid, name: 'Gone', isAvailable: false },
              { udid: '../etc/passwd', name: 'Traversal', isAvailable: false },
              { udid: 'not-a-udid', name: 'Bogus', isAvailable: false },
              { name: 'No UDID', isAvailable: false }
            ],
            'com.apple.CoreSimulator.SimRuntime.tvOS-16-0': 'not-an-array'
          }
        })
      }
      return new Error('unavailable')
    })

    const result = await runScan(90, vi.fn())
    const extra = result.items.filter((item) =>
      ['xcodeArchives', 'coreSimulatorCaches', 'unavailableSimulators'].includes(item.categoryId)
    )

    expect(extra.map((item) => item.name || item.nameKey)).toEqual([
      'category.xcodeArchives.title',
      'category.coreSimulatorCaches.title',
      'iPhone 14'
    ])
    expect(extra.map((item) => item.path)).toEqual([archives, simCaches, unavailablePath])
    expect(extra.every((item) => item.selectedByDefault === false && item.optional === true)).toBe(true)
    expect(extra.every((item) => item.bytes > 0)).toBe(true)
    expect(result.items.some((item) => item.path === developer)).toBe(false)
    expect(result.items.some((item) => item.path === devicesRoot)).toBe(false)
    expect(result.items.some((item) => item.path === availablePath)).toBe(false)
    expect(result.items.some((item) => item.path === missingPath)).toBe(false)
  })

  it('lists working simulators only when a newer runtime of the same platform exists', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    const devicesRoot = `${home}/Library/Developer/CoreSimulator/Devices`
    const oldUdid = '11111111-1111-1111-1111-111111111111'
    const newestUdid = '22222222-2222-2222-2222-222222222222'
    const soleUdid = '33333333-3333-3333-3333-333333333333'
    const unparsedUdid = '44444444-4444-4444-4444-444444444444'
    const oldPath = `${devicesRoot}/${oldUdid}`

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['good']
      if (path.startsWith(devicesRoot)) return ['payload']
      if (path === '/Applications' || path === `${home}/Applications`) return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path.endsWith('/payload') || path.endsWith('/good')) return file(200)
      return directory
    })
    execResult((command) => {
      if (command !== 'xcrun') return new Error('unavailable')
      return JSON.stringify({
        devices: {
          'com.apple.CoreSimulator.SimRuntime.iOS-18-1': [
            { udid: oldUdid, name: 'iPhone 16 Pro', isAvailable: true }
          ],
          'com.apple.CoreSimulator.SimRuntime.iOS-26-4': [
            { udid: newestUdid, name: 'iPhone 17 Pro', isAvailable: true }
          ],
          'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [
            { udid: soleUdid, name: 'Apple Watch Series 10', isAvailable: true }
          ],
          'com.apple.CoreSimulator.SimRuntime.Unrecognized': [
            { udid: unparsedUdid, name: 'Mystery', isAvailable: true }
          ]
        }
      })
    })

    const result = await runScan(90, vi.fn())
    const outdated = result.items.filter((item) => item.categoryId === 'outdatedSimulators')

    expect(outdated).toHaveLength(1)
    expect(outdated[0]).toMatchObject({
      name: 'iPhone 16 Pro (iOS 18.1)',
      path: oldPath,
      selectedByDefault: false,
      optional: true
    })
    expect(result.items.some((item) => item.path === `${devicesRoot}/${newestUdid}`)).toBe(false)
    expect(result.items.some((item) => item.path === `${devicesRoot}/${soleUdid}`)).toBe(false)
    expect(result.items.some((item) => item.path === `${devicesRoot}/${unparsedUdid}`)).toBe(false)
  })

  it('skips unavailable simulators when simctl is missing or returns invalid JSON', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['good']
      if (path === '/Applications' || path === `${home}/Applications`) return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path.endsWith('/good')) return file(200)
      return directory
    })

    const missing = await runScan(90, vi.fn())
    expect(missing.items.some((item) => item.categoryId === 'unavailableSimulators')).toBe(false)

    execResult(() => '{')
    const invalid = await runScan(90, vi.fn())
    expect(invalid.items.some((item) => item.categoryId === 'unavailableSimulators')).toBe(false)

    execResult(() => JSON.stringify({ devices: null }))
    const empty = await runScan(90, vi.fn())
    expect(empty.items.some((item) => item.categoryId === 'unavailableSimulators')).toBe(false)

    execResult(() => 'null')
    const none = await runScan(90, vi.fn())
    expect(none.items.some((item) => item.categoryId === 'unavailableSimulators')).toBe(false)

    execResult(() => '[]')
    const list = await runScan(90, vi.fn())
    expect(list.items.some((item) => item.categoryId === 'unavailableSimulators')).toBe(false)

    execResult(() => JSON.stringify({ devices: [] }))
    const noGroups = await runScan(90, vi.fn())
    expect(noGroups.items.some((item) => item.categoryId === 'unavailableSimulators')).toBe(false)
  })

  it('scans documented Docker Desktop leftovers as opt-in and skips missing paths', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    const dockerRaw = `${home}/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw`
    const dockerQcow = `${home}/Library/Containers/com.docker.docker/Data/vms/0/Docker.qcow2`
    const dockerContainer = `${home}/Library/Containers/com.docker.docker`
    const buildx = `${home}/.docker/buildx`

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['good']
      if (path === buildx) return ['payload']
      if (path === '/Applications' || path === `${home}/Applications`) return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path === dockerQcow || path === dockerContainer) throw new Error('missing')
      if (path === dockerRaw) return file(4096)
      if (path.endsWith('/payload') || path.endsWith('/good')) return file(200)
      return directory
    })

    const result = await runScan(90, vi.fn())
    const dockerItems = result.items.filter((item) => item.categoryId === 'dockerDesktop')

    expect(dockerItems.map((item) => item.nameKey)).toEqual([
      'category.dockerDesktop.diskImage',
      'category.dockerDesktop.buildx'
    ])
    expect(dockerItems.map((item) => item.path)).toEqual([dockerRaw, buildx])
    expect(dockerItems.every((item) => item.selectedByDefault === false && item.optional === true)).toBe(
      true
    )
    expect(result.items.some((item) => item.path === dockerContainer)).toBe(false)
    expect(result.items.some((item) => item.path === dockerQcow)).toBe(false)
  })

  it('scans known package-manager roots as opt-in and skips them in user caches', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    const pnpm = `${caches}/pnpm`
    const cargoRegistry = `${home}/.cargo/registry`
    const missingNpm = `${home}/.npm`

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['pnpm', 'good']
      if (path === pnpm || path === cargoRegistry) return ['payload']
      if (path === '/Applications' || path === `${home}/Applications`) return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path === missingNpm) throw new Error('missing')
      if (path.endsWith('/payload') || path.endsWith('/good')) return file(200)
      return directory
    })

    const result = await runScan(90, vi.fn())
    const userCacheNames = result.items
      .filter((item) => item.categoryId === 'userCaches')
      .map((item) => item.name)
    const packageItems = result.items.filter((item) => item.categoryId === 'packageManagerCaches')

    expect(userCacheNames).toEqual(['good'])
    expect(packageItems.map((item) => item.nameKey)).toEqual([
      'category.packageManagerCaches.pnpm',
      'category.packageManagerCaches.cargoRegistry'
    ])
    expect(packageItems.every((item) => item.selectedByDefault === false && item.optional === true)).toBe(
      true
    )
    expect(packageItems.every((item) => item.bytes > 0)).toBe(true)
    expect(result.items.some((item) => item.path === missingNpm)).toBe(false)
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
