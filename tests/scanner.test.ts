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
import { DEFAULT_SCAN_CATEGORIES } from '../src/shared/constants'

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
    ['/Users/test/.gradle/caches', true],
    ['/Users/test/Library/Caches/CocoaPods', true],
    ['/Users/test/.android/cache', true],
    ['/Users/test/Library/Android/sdk/cache', true],
    ['/Users/test/Documents', false],
    ['/Users/test/Desktop', false],
    ['/Users/test/Downloads', false],
    ['/Users/test/Documents/Archive 2022', true],
    ['/Users/test/Desktop/OldBackup.iso', true],
    ['/Users/test/Downloads/installer.dmg', true],
    ['/Users/test/Downloads/OldFolder', true]
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
    expect(progress).toHaveBeenCalledTimes(12)
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.packageManagers', percent: 44 })
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.androidDev', percent: 68 })
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.docker', percent: 72 })
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.documentsDesktop', percent: 76 })
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.downloads', percent: 80 })
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.apps', percent: 84 })
    expect(progress).toHaveBeenLastCalledWith({ phase: 'progress.done', percent: 100 })
  })

  it('skips a disabled category without touching Spotlight', async () => {
    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === '/Applications') return ['Old.app']
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path.endsWith('.app')) return file(500)
      return directory
    })
    execResult(() => new Date(Date.now() - 200 * 86400000).toISOString())

    const progress = vi.fn()
    const result = await runScan(90, progress, {
      ...DEFAULT_SCAN_CATEGORIES,
      unusedApps: false
    })
    expect(result.items.some((item) => item.categoryId === 'unusedApps')).toBe(false)
    expect(mocks.execFile.mock.calls.some(([command]) => command === 'mdls')).toBe(false)
    expect(progress).toHaveBeenCalledWith({ phase: 'progress.apps', percent: 84 })
  })

  it('touches no scan root when every category is disabled', async () => {
    const disabled = Object.fromEntries(
      Object.keys(DEFAULT_SCAN_CATEGORIES).map((id) => [id, false])
    ) as typeof DEFAULT_SCAN_CATEGORIES

    const progress = vi.fn()
    const result = await runScan(90, progress, disabled)
    expect(result.items).toEqual([])
    expect(result.limited).toBe(false)
    expect(mocks.readdir).not.toHaveBeenCalled()
    expect(mocks.lstat).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
    // Every phase is still announced so the progress bar does not look stuck.
    expect(progress).toHaveBeenCalledTimes(12)
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

  it('scans old large first-level Documents and Desktop items as opt-in', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    const documents = `${home}/Documents`
    const desktop = `${home}/Desktop`
    const oldLarge = `${documents}/Archive 2022`
    const oldFolder = `${documents}/OldProject`
    const nested = `${oldFolder}/nested.bin`
    const oldSmall = `${documents}/notes.pdf`
    const recentLarge = `${documents}/Current.dmg`
    const desktopDump = `${desktop}/OldBackup.iso`
    const mb = 1024 * 1024
    const oldMs = Date.now() - 400 * 86400000
    const recentMs = Date.now() - 2 * 86400000

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['good']
      if (path === documents) return ['Archive 2022', 'OldProject', 'notes.pdf', 'Current.dmg']
      if (path === desktop) return ['OldBackup.iso']
      if (path === oldFolder) return ['nested.bin']
      if (path === '/Applications' || path === `${home}/Applications`) return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path === oldLarge) return { ...file(250 * mb), mtimeMs: oldMs }
      if (path === oldFolder) return { ...directory, mtimeMs: oldMs }
      if (path === nested) return { ...file(180 * mb), mtimeMs: oldMs }
      if (path === oldSmall) return { ...file(20 * mb), mtimeMs: oldMs }
      if (path === recentLarge) return { ...file(400 * mb), mtimeMs: recentMs }
      if (path === desktopDump) return { ...file(120 * mb), mtimeMs: oldMs }
      if (path.endsWith('/good')) return file(200)
      return directory
    })

    const result = await runScan(90, vi.fn())
    const idle = result.items.filter((item) => item.categoryId === 'idleUserFolders')

    expect(idle.map((item) => item.name)).toEqual(['Archive 2022', 'OldProject', 'OldBackup.iso'])
    expect(idle.map((item) => item.path)).toEqual([oldLarge, oldFolder, desktopDump])
    expect(idle.every((item) => item.selectedByDefault === false && item.optional === true)).toBe(true)
    expect(idle.every((item) => item.daysIdle !== null && item.daysIdle >= 90)).toBe(true)
    expect(result.items.some((item) => item.path === documents)).toBe(false)
    expect(result.items.some((item) => item.path === desktop)).toBe(false)
    expect(result.items.some((item) => item.path === oldSmall)).toBe(false)
    expect(result.items.some((item) => item.path === recentLarge)).toBe(false)
    expect(result.items.some((item) => item.path === nested)).toBe(false)
  })

  it('skips missing Documents and Desktop roots', async () => {
    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === '/Users/test/Library/Caches') return ['good']
      if (path === '/Users/test/Documents' || path === '/Users/test/Desktop') throw new Error('missing')
      if (path === '/Applications' || path === '/Users/test/Applications') return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path.endsWith('/good')) return file(200)
      return directory
    })

    const result = await runScan(90, vi.fn())
    expect(result.items.some((item) => item.categoryId === 'idleUserFolders')).toBe(false)
  })

  it('skips Documents children that cannot be statted', async () => {
    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === '/Users/test/Library/Caches') return ['good']
      if (path === '/Users/test/Documents') return ['gone.bin']
      if (path === '/Users/test/Desktop') throw new Error('missing')
      if (path === '/Applications' || path === '/Users/test/Applications') return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path === '/Users/test/Documents/gone.bin') throw new Error('gone')
      if (path.endsWith('/good')) return file(200)
      return directory
    })

    const result = await runScan(90, vi.fn())
    expect(result.items.some((item) => item.path.endsWith('gone.bin'))).toBe(false)
  })

  it('keeps the largest idle Documents and Desktop items up to the cap', async () => {
    const desktop = '/Users/test/Desktop'
    const oldMs = Date.now() - 400 * 86400000
    const mb = 1024 * 1024

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === '/Users/test/Library/Caches') return ['good']
      if (path === '/Users/test/Documents') throw new Error('missing')
      if (path === desktop) return Array.from({ length: 26 }, (_, index) => `dump-${index}.bin`)
      if (path === '/Applications' || path === '/Users/test/Applications') return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      const match = /dump-(\d+)\.bin$/.exec(path)
      if (match) return { ...file((100 + Number(match[1])) * mb), mtimeMs: oldMs }
      if (path.endsWith('/good')) return file(200)
      return directory
    })

    const result = await runScan(90, vi.fn())
    const idle = result.items.filter((item) => item.categoryId === 'idleUserFolders')

    expect(idle).toHaveLength(24)
    expect(idle[0].name).toBe('dump-25.bin')
    expect(idle.some((item) => item.name === 'dump-0.bin')).toBe(false)
    expect(idle.some((item) => item.name === 'dump-1.bin')).toBe(false)
  })

  it('scans known Android, Gradle and CocoaPods leftover caches as opt-in', async () => {
    const home = '/Users/test'
    const caches = `${home}/Library/Caches`
    const gradle = `${home}/.gradle/caches`
    const cocoapods = `${caches}/CocoaPods`
    const sdkCache = `${home}/Library/Android/sdk/cache`
    const sdkRoot = `${home}/Library/Android/sdk`
    const avd = `${home}/.android/avd`
    const missingAndroidCache = `${home}/.android/cache`

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === caches) return ['CocoaPods', 'good']
      if (path === gradle || path === cocoapods || path === sdkCache) return ['payload']
      if (path === '/Applications' || path === `${home}/Applications`) return []
      return []
    })
    mocks.lstat.mockImplementation(async (path: string) => {
      if (path === missingAndroidCache || path === sdkRoot || path === avd) throw new Error('missing')
      if (path.endsWith('/payload') || path.endsWith('/good')) return file(200)
      return directory
    })

    const result = await runScan(90, vi.fn())
    const userCacheNames = result.items
      .filter((item) => item.categoryId === 'userCaches')
      .map((item) => item.name)
    const mobileItems = result.items.filter((item) => item.categoryId === 'androidDevCaches')

    expect(userCacheNames).toEqual(['good'])
    expect(mobileItems.map((item) => item.nameKey)).toEqual([
      'category.androidDevCaches.gradle',
      'category.androidDevCaches.cocoapods',
      'category.androidDevCaches.sdkCache'
    ])
    expect(mobileItems.map((item) => item.path)).toEqual([gradle, cocoapods, sdkCache])
    expect(mobileItems.every((item) => item.selectedByDefault === false && item.optional === true)).toBe(
      true
    )
    expect(mobileItems.every((item) => item.bytes > 0)).toBe(true)
    expect(result.items.some((item) => item.path === missingAndroidCache)).toBe(false)
    expect(result.items.some((item) => item.path === sdkRoot)).toBe(false)
    expect(result.items.some((item) => item.path === avd)).toBe(false)
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

  it('scans Downloads folder with age and size filters, skips symlinks and caps at 50', async () => {
    const home = '/Users/test'
    const downloads = `${home}/Downloads`
    const now = Date.now()
    const ninetyDaysAgo = now - 90 * 86400000
    const tenDaysAgo = now - 10 * 86400000

    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === downloads) {
        return [
          '.DS_Store',
          '.localized',
          'symlink.zip',
          'old_large.dmg',
          'old_small.txt',
          'recent_large.iso',
          'old_folder'
        ]
      }
      if (path === `${downloads}/old_folder`) return ['nested_file.bin']
      return []
    })

    mocks.lstat.mockImplementation(async (path: string) => {
      if (path.endsWith('.DS_Store') || path.endsWith('.localized')) return file(100)
      if (path.endsWith('symlink.zip')) return symlink
      if (path.endsWith('old_large.dmg')) return { ...file(100 * 1024 * 1024), mtimeMs: ninetyDaysAgo }
      if (path.endsWith('old_small.txt')) return { ...file(1024), mtimeMs: ninetyDaysAgo }
      if (path.endsWith('recent_large.iso')) return { ...file(500 * 1024 * 1024), mtimeMs: tenDaysAgo }
      if (path.endsWith('old_folder')) return { ...directory, mtimeMs: ninetyDaysAgo }
      if (path.endsWith('nested_file.bin')) return file(200 * 1024 * 1024)
      return directory
    })

    mocks.stat.mockImplementation(async (path: string) => {
      if (path.endsWith('old_large.dmg')) return { mtimeMs: ninetyDaysAgo }
      if (path.endsWith('old_small.txt')) return { mtimeMs: ninetyDaysAgo }
      if (path.endsWith('recent_large.iso')) return { mtimeMs: tenDaysAgo }
      if (path.endsWith('old_folder')) return { mtimeMs: ninetyDaysAgo }
      return { mtimeMs: now }
    })

    const result = await runScan(
      90,
      vi.fn(),
      {
        ...DEFAULT_SCAN_CATEGORIES,
        downloadsReview: true
      },
      30,
      50 * 1024 * 1024
    )

    const dlItems = result.items.filter((item) => item.categoryId === 'downloadsReview')
    expect(dlItems.map((item) => item.name)).toEqual(['old_folder', 'old_large.dmg'])
    expect(dlItems.every((item) => item.selectedByDefault === false && item.optional === true)).toBe(true)
    expect(dlItems.every((item) => item.daysIdle !== null && item.daysIdle >= 30)).toBe(true)
  })

  it('handles missing Downloads folder gracefully', async () => {
    mocks.readdir.mockImplementation(async (path: string) => {
      if (path === '/Users/test/Downloads') throw new Error('ENOENT')
      return []
    })

    const result = await runScan(
      90,
      vi.fn(),
      {
        ...DEFAULT_SCAN_CATEGORIES,
        downloadsReview: true
      }
    )

    const dlItems = result.items.filter((item) => item.categoryId === 'downloadsReview')
    expect(dlItems).toEqual([])
  })
})
