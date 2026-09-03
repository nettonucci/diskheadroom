import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  readdir: vi.fn(),
  trashItem: vi.fn(),
  openExternal: vi.fn(),
  showItemInFolder: vi.fn(),
  quit: vi.fn(),
  setLoginItemSettings: vi.fn(),
  getLoginItemSettings: vi.fn(() => ({
    openAtLogin: false,
    openAsHidden: false,
    wasOpenedAtLogin: false,
    wasOpenedAsHidden: false
  })),
  getPath: vi.fn((key: string) => key === 'exe'
    ? '/Applications/Disk Headroom.app/Contents/MacOS/Disk Headroom'
    : '/tmp/diskheadroom'),
  getLocale: vi.fn(() => 'pt_BR'),
  isPackaged: true,
  imageEmpty: false,
  setTemplateImage: vi.fn(),
  setContextMenu: vi.fn(),
  setToolTip: vi.fn(),
  trayOn: vi.fn(),
  buildFromTemplate: vi.fn((template) => template),
  createFromPath: vi.fn()
}))

vi.mock('node:child_process', () => ({
  default: { execFile: mocks.execFile },
  execFile: mocks.execFile
}))
vi.mock('node:fs/promises', () => {
  const module = {
    readFile: mocks.readFile,
    writeFile: mocks.writeFile,
    mkdir: mocks.mkdir,
    open: mocks.open,
    readdir: mocks.readdir,
    lstat: vi.fn(),
    readlink: vi.fn(),
    stat: vi.fn()
  }
  return { default: module, ...module }
})
vi.mock('node:os', () => ({
  default: { homedir: () => '/Users/test' },
  homedir: () => '/Users/test'
}))
vi.mock('electron', () => {
  class Tray {
    setContextMenu = mocks.setContextMenu
    setToolTip = mocks.setToolTip
    on = mocks.trayOn
  }
  return {
    app: {
      getPath: mocks.getPath,
      getLocale: mocks.getLocale,
      get isPackaged() { return mocks.isPackaged },
      quit: mocks.quit,
      setLoginItemSettings: mocks.setLoginItemSettings,
      getLoginItemSettings: mocks.getLoginItemSettings,
      getAppPath: () => '/project'
    },
    shell: {
      trashItem: mocks.trashItem,
      openExternal: mocks.openExternal,
      showItemInFolder: mocks.showItemInFolder
    },
    Tray,
    Menu: { buildFromTemplate: mocks.buildFromTemplate },
    nativeImage: { createFromPath: mocks.createFromPath }
  }
})

import { trashPaths } from '../src/main/cleaner'
import { getDiskInfo } from '../src/main/disk'
import {
  getGrantTarget,
  getPermissionStatus,
  openFullDiskAccessSettings,
  revealGrantTarget
} from '../src/main/permissions'
import { applyLaunchAtLogin, shouldShowWindowOnLaunch } from '../src/main/loginItem'
import { loadSettings, peekLicenseKeyFallback, saveSettings, setLicenseKeyFallback } from '../src/main/settings'
import { createTray } from '../src/main/tray'
import { DEFAULT_LARGE_FILE_MIN_BYTES, DEFAULT_SCAN_CATEGORIES } from '../src/shared/constants'

function callbackResult(stdout: string, error: Error | null = null): void {
  mocks.execFile.mockImplementationOnce((_cmd, _args, callback) => callback(error, { stdout, stderr: '' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(process, 'resourcesPath', {
    value: '/resources',
    configurable: true
  })
  mocks.isPackaged = true
  mocks.imageEmpty = false
  mocks.createFromPath.mockReturnValue({
    isEmpty: () => mocks.imageEmpty,
    setTemplateImage: mocks.setTemplateImage
  })
})

describe('disk', () => {
  it('parses df output', async () => {
    callbackResult('Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1s1 100 60 40 60% 1 2 1% /')
    await expect(getDiskInfo()).resolves.toEqual({
      mount: '/',
      totalBytes: 102400,
      usedBytes: 61440,
      freeBytes: 40960
    })
  })

  it('derives used space from the APFS container instead of the sealed system volume', async () => {
    callbackResult(
      'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s1s1 482797652 16701344 95931472 15% 458726 959314720 0% /'
    )
    await expect(getDiskInfo()).resolves.toEqual({
      mount: '/',
      totalBytes: 482797652 * 1024,
      usedBytes: (482797652 - 95931472) * 1024,
      freeBytes: 95931472 * 1024
    })
  })

  it('never reports negative usage when available exceeds the total', async () => {
    callbackResult('header\n/dev/disk 10 4 12 0% 1 2 1% /')
    await expect(getDiskInfo()).resolves.toMatchObject({ usedBytes: 0 })
  })

  it('rejects malformed output', async () => {
    callbackResult('Filesystem')
    await expect(getDiskInfo()).rejects.toThrow('Unable to read disk capacity')
  })

  it('uses slash when df omits the mount column', async () => {
    callbackResult('header\n/dev/disk 10 4 6')
    await expect(getDiskInfo()).resolves.toMatchObject({ mount: '/' })
  })
})

describe('settings', () => {
  it('returns localized defaults when the file is absent', async () => {
    mocks.readFile.mockRejectedValue(new Error('ENOENT'))
    await expect(loadSettings()).resolves.toEqual({
      unusedDays: 90,
      setupComplete: false,
      locale: 'pt-BR',
      scanCategories: DEFAULT_SCAN_CATEGORIES,
      largeFileMinBytes: DEFAULT_LARGE_FILE_MIN_BYTES,
      downloadsMinDays: 30,
      downloadsMinBytes: 50 * 1024 * 1024,
      lowDiskAlert: { enabled: false, kind: 'percent', value: 10 },
      launchAtLogin: false,
      scanReminder: { enabled: false, intervalDays: 7 },
      neverTouchPaths: []
    })
  })

  it('merges persisted settings and normalizes locale', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        unusedDays: 180,
        downloadsMinDays: 60,
        downloadsMinBytes: 104857600,
        locale: 'es-MX'
      })
    )
    await expect(loadSettings()).resolves.toMatchObject({
      unusedDays: 180,
      downloadsMinDays: 60,
      downloadsMinBytes: 104857600,
      locale: 'es'
    })
  })

  it('keeps disabled scan categories and defaults the ones the file omits', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ unusedDays: 180, scanCategories: { unusedApps: false } })
    )
    await expect(loadSettings()).resolves.toMatchObject({
      unusedDays: 180,
      scanCategories: { ...DEFAULT_SCAN_CATEGORIES, unusedApps: false }
    })
  })

  it('fills in launch-at-login and scan-reminder defaults when the file omits them', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({ unusedDays: 90, locale: 'en' }))
    await expect(loadSettings()).resolves.toMatchObject({
      downloadsMinDays: 30,
      downloadsMinBytes: 52428800,
      lowDiskAlert: { enabled: false, kind: 'percent', value: 10 },
      launchAtLogin: false,
      scanReminder: { enabled: false, intervalDays: 7 }
    })
  })

  it('keeps never-touch prefixes and drops junk entries', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({
        neverTouchPaths: ['/Users/test/Library/Caches/keep', '/', 'relative', '/Users/test/Library/Caches/keep']
      })
    )
    await expect(loadSettings()).resolves.toMatchObject({
      neverTouchPaths: ['/Users/test/Library/Caches/keep']
    })
  })

  it('uses the default locale when omitted', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify({ setupComplete: true }))
    await expect(loadSettings()).resolves.toMatchObject({ setupComplete: true, locale: 'pt-BR' })
  })

  it('strips a fallback license key from settings returned to the renderer', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ locale: 'en', licenseKey: 'dh1.should-not-leak' })
    )
    const loaded = await loadSettings()
    expect(loaded).not.toHaveProperty('licenseKey')
    expect(JSON.stringify(loaded)).not.toContain('dh1.should-not-leak')
  })

  it('keeps a fallback license key when the rest of settings are saved', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ locale: 'en', licenseKey: 'dh1.keep-me' })
    )
    const value = {
      unusedDays: 30 as const,
      setupComplete: true,
      locale: 'en' as const,
      scanCategories: { ...DEFAULT_SCAN_CATEGORIES, unusedApps: false },
      lowDiskAlert: { enabled: false, kind: 'percent' as const, value: 10 },
      launchAtLogin: false,
      scanReminder: { enabled: false, intervalDays: 7 as const },
      neverTouchPaths: []
    }
    await saveSettings(value)
    const written = JSON.parse(String(mocks.writeFile.mock.calls[0][1])) as {
      licenseKey?: string
      locale: string
    }
    expect(written.licenseKey).toBe('dh1.keep-me')
    expect(written.locale).toBe('en')
  })

  it('reads and writes the fallback license field without exposing it through loadSettings', async () => {
    mocks.readFile.mockResolvedValue(
      JSON.stringify({ locale: 'en', licenseKey: '  dh1.from-file  ' })
    )
    await expect(peekLicenseKeyFallback()).resolves.toBe('dh1.from-file')
    mocks.readFile.mockResolvedValue(JSON.stringify({ locale: 'en', licenseKey: 12 }))
    await expect(peekLicenseKeyFallback()).resolves.toBeNull()
    mocks.readFile.mockResolvedValue(JSON.stringify({ locale: 'en' }))
    await setLicenseKeyFallback('dh1.stored')
    expect(JSON.parse(String(mocks.writeFile.mock.calls.at(-1)?.[1]))).toEqual(
      expect.objectContaining({ licenseKey: 'dh1.stored', locale: 'en' })
    )
    await setLicenseKeyFallback(null)
    expect(JSON.parse(String(mocks.writeFile.mock.calls.at(-1)?.[1]))).not.toHaveProperty(
      'licenseKey'
    )
  })

  it('creates the directory and writes formatted JSON', async () => {
    const value = {
      unusedDays: 30 as const,
      setupComplete: true,
      locale: 'en' as const,
      scanCategories: { ...DEFAULT_SCAN_CATEGORIES, unusedApps: false },
      lowDiskAlert: { enabled: false, kind: 'percent' as const, value: 10 },
      launchAtLogin: false,
      scanReminder: { enabled: false, intervalDays: 7 as const },
      neverTouchPaths: []
    }
    await saveSettings(value)
    expect(mocks.mkdir).toHaveBeenCalledWith('/tmp/diskheadroom', { recursive: true })
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/diskheadroom/settings.json',
      JSON.stringify(value, null, 2),
      'utf8'
    )
  })
})

describe('cleaner', () => {
  it('rejects unsafe paths and reports partial failures', async () => {
    mocks.trashItem
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('locked'))
      .mockRejectedValueOnce('unknown')
    const lastScanPaths = new Set([
      '/',
      '/Users/test/cache-a',
      '/Users/test/cache-b',
      '/Users/test/cache-c'
    ])
    const result = await trashPaths(
      { paths: ['/', '/Users/test/cache-a', '/Users/test/cache-b', '/Users/test/cache-c'] },
      new Map([
        ['/Users/test/cache-a', 10],
        ['/Users/test/cache-b', 20]
      ]),
      { lastScanPaths, neverTouchPaths: [] }
    )
    expect(result).toEqual({
      trashed: ['/Users/test/cache-a'],
      failed: [
        { path: '/', error: 'Path is outside the allowed scan roots' },
        { path: '/Users/test/cache-b', error: 'locked' },
        { path: '/Users/test/cache-c', error: 'Could not move to Trash' }
      ],
      bytesRequested: 30
    })
  })

  it('does not trash paths that were not in the last scan', async () => {
    const result = await trashPaths(
      { paths: ['/Users/test/cache-a', '/Users/test/unknown'] },
      new Map([['/Users/test/cache-a', 10]]),
      { lastScanPaths: new Set(['/Users/test/cache-a']), neverTouchPaths: [] }
    )
    expect(mocks.trashItem).toHaveBeenCalledTimes(1)
    expect(mocks.trashItem).toHaveBeenCalledWith('/Users/test/cache-a')
    expect(result).toEqual({
      trashed: ['/Users/test/cache-a'],
      failed: [{ path: '/Users/test/unknown', error: 'Path was not in the last scan' }],
      bytesRequested: 10
    })
  })

  it('refuses never-touch paths even when they were in the last scan', async () => {
    const result = await trashPaths(
      { paths: ['/Users/test/Library/Caches/keep'] },
      new Map([['/Users/test/Library/Caches/keep', 99]]),
      {
        lastScanPaths: new Set(['/Users/test/Library/Caches/keep']),
        neverTouchPaths: ['/Users/test/Library/Caches/keep']
      }
    )
    expect(mocks.trashItem).not.toHaveBeenCalled()
    expect(result).toEqual({
      trashed: [],
      failed: [{ path: '/Users/test/Library/Caches/keep', error: 'Path is on the never-touch list' }],
      bytesRequested: 0
    })
  })
})

describe('permissions', () => {
  it('checks file and directory access', async () => {
    mocks.open
      .mockResolvedValueOnce({ close: vi.fn() })
      .mockRejectedValueOnce(new Error('denied'))
    mocks.readdir.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('denied'))
    await expect(getPermissionStatus()).resolves.toEqual({
      fullDiskAccess: true,
      libraryCachesReadable: true,
      applicationsReadable: false
    })
  })

  it('falls back through System Settings URLs', async () => {
    mocks.openExternal
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockResolvedValueOnce(undefined)
    await openFullDiskAccessSettings()
    expect(mocks.openExternal).toHaveBeenCalledTimes(3)
  })

  it('stops after the first System Settings URL succeeds', async () => {
    mocks.openExternal.mockResolvedValue(undefined)
    await openFullDiskAccessSettings()
    expect(mocks.openExternal).toHaveBeenCalledTimes(1)
  })

  it('describes packaged and development grant targets', () => {
    process.env.__CFBundleIdentifier = 'com.apple.Terminal'
    expect(getGrantTarget()).toEqual({
      displayName: 'Disk Headroom',
      bundlePath: '/Applications/Disk Headroom.app',
      packaged: true,
      launchedBy: 'Terminal'
    })
    process.env.__CFBundleIdentifier = 'com.nettonucci.diskheadroom'
    expect(getGrantTarget().launchedBy).toBeNull()
    process.env.__CFBundleIdentifier = 'com.example.UnknownLauncher'
    expect(getGrantTarget().launchedBy).toBe('com.example.UnknownLauncher')
    mocks.getPath.mockReturnValueOnce('/usr/local/bin/electron')
    expect(getGrantTarget().bundlePath).toBe('/usr/local/bin/electron')
    delete process.env.__CFBundleIdentifier
    expect(getGrantTarget().launchedBy).toBeNull()
  })

  it('reveals the responsible bundle', () => {
    revealGrantTarget()
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/Applications/Disk Headroom.app')
  })
})

describe('tray', () => {
  it('creates and relocalizes its menu', () => {
    const actions = { showWindow: vi.fn(), scanNow: vi.fn(), openDonate: vi.fn() }
    const controller = createTray(actions, 'en')
    expect(mocks.setTemplateImage).toHaveBeenCalledWith(true)
    expect(mocks.setToolTip).toHaveBeenCalledWith('Disk Headroom')
    expect(mocks.trayOn).toHaveBeenCalledWith('click', actions.showWindow)
    expect(mocks.setContextMenu).toHaveBeenCalledTimes(1)

    controller.setLocale('pt-BR')
    const menu = mocks.buildFromTemplate.mock.calls.at(-1)?.[0]
    expect(menu[0].label).toBe('Abrir Disk Headroom')
    menu[5].click()
    expect(mocks.quit).toHaveBeenCalled()
  })

  it('supports an empty image and development resource path', () => {
    mocks.imageEmpty = true
    mocks.isPackaged = false
    createTray({ showWindow: vi.fn(), scanNow: vi.fn(), openDonate: vi.fn() }, 'es')
    expect(mocks.setTemplateImage).not.toHaveBeenCalled()
    expect(mocks.createFromPath).toHaveBeenCalledWith('/project/resources/trayTemplate.png')
  })
})

describe('login item', () => {
  it('enables and disables the macOS login item through Electron', () => {
    applyLaunchAtLogin(true)
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      openAsHidden: true
    })
    applyLaunchAtLogin(false)
    expect(mocks.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: false,
      openAsHidden: true
    })
  })

  it('hides the window when the app was opened at login', () => {
    mocks.getLoginItemSettings.mockReturnValueOnce({
      openAtLogin: true,
      openAsHidden: true,
      wasOpenedAtLogin: true,
      wasOpenedAsHidden: true
    })
    expect(shouldShowWindowOnLaunch()).toBe(false)
    expect(shouldShowWindowOnLaunch()).toBe(true)
  })
})
