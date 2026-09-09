import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  writeText: vi.fn(),
  openExternal: vi.fn(),
  showItemInFolder: vi.fn(),
  getDiskInfo: vi.fn(),
  getPermissionStatus: vi.fn(),
  openFullDiskAccessSettings: vi.fn(),
  getGrantTarget: vi.fn(),
  revealGrantTarget: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  runScan: vi.fn(),
  trashPaths: vi.fn(),
  applyLaunchAtLogin: vi.fn(),
  showOpenDialog: vi.fn(),
  getLicenseStatus: vi.fn(),
  activateLicense: vi.fn(),
  getForecastStatus: vi.fn(),
  getUpdateStatus: vi.fn(),
  checkForAppUpdates: vi.fn(),
  downloadAppUpdate: vi.fn(),
  installAppUpdate: vi.fn(),
  attachUpdateListener: vi.fn()
}))

vi.mock('electron', () => {
  const module = {
    clipboard: { writeText: mocks.writeText },
    dialog: { showOpenDialog: mocks.showOpenDialog },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler)
    }
    },
    shell: { openExternal: mocks.openExternal, showItemInFolder: mocks.showItemInFolder }
  }
  return { default: module, ...module }
})
vi.mock('../src/main/disk', () => ({ getDiskInfo: mocks.getDiskInfo }))
vi.mock('../src/main/permissions', () => ({
  getPermissionStatus: mocks.getPermissionStatus,
  openFullDiskAccessSettings: mocks.openFullDiskAccessSettings,
  getGrantTarget: mocks.getGrantTarget,
  revealGrantTarget: mocks.revealGrantTarget
}))
vi.mock('../src/main/settings', () => ({
  loadSettings: mocks.loadSettings,
  saveSettings: mocks.saveSettings
}))
vi.mock('../src/main/scanner', async () => {
  const actual = await vi.importActual<typeof import('../src/main/scanner')>('../src/main/scanner')
  return { ...actual, runScan: mocks.runScan }
})
vi.mock('../src/main/cleaner', () => ({ trashPaths: mocks.trashPaths }))
vi.mock('../src/main/loginItem', () => ({ applyLaunchAtLogin: mocks.applyLaunchAtLogin }))
vi.mock('../src/main/license', () => ({
  getLicenseStatus: mocks.getLicenseStatus,
  activateLicense: mocks.activateLicense
}))
vi.mock('../src/main/headroomForecast', () => ({
  getForecastStatus: mocks.getForecastStatus
}))
vi.mock('../src/main/updates', () => ({
  attachUpdateListener: mocks.attachUpdateListener,
  getUpdateStatus: mocks.getUpdateStatus,
  checkForAppUpdates: mocks.checkForAppUpdates,
  downloadAppUpdate: mocks.downloadAppUpdate,
  installAppUpdate: mocks.installAppUpdate
}))

import { registerIpc } from '../src/main/ipc'

const call = (channel: string, ...args: unknown[]): unknown => {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.loadSettings.mockResolvedValue({ neverTouchPaths: [] })
  mocks.getLicenseStatus.mockResolvedValue({ isPro: false })
})

describe('IPC registration', () => {
  it('wires information and permission handlers', async () => {
    mocks.getDiskInfo.mockResolvedValue({ mount: '/' })
    mocks.getPermissionStatus.mockResolvedValue({ fullDiskAccess: true })
    mocks.getGrantTarget.mockReturnValue({ displayName: 'Disk Headroom' })
    mocks.loadSettings.mockResolvedValue({ locale: 'en' })

    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    expect(mocks.handlers.size).toBe(21)
    await expect(call('disk:info')).resolves.toEqual({ mount: '/' })
    await expect(call('permissions:status')).resolves.toEqual({ fullDiskAccess: true })
    expect(call('permissions:open-fda')).toBeUndefined()
    expect(call('permissions:grant-target')).toEqual({ displayName: 'Disk Headroom' })
    call('permissions:reveal-target')
    expect(mocks.revealGrantTarget).toHaveBeenCalled()
    await expect(call('settings:get')).resolves.toEqual({ locale: 'en' })
  })

  it('saves settings and updates the tray locale when available', async () => {
    const setLocale = vi.fn()
    const onSettingsChanged = vi.fn()
    registerIpc({
      sendToRenderer: vi.fn(),
      getTrayController: () => ({ setLocale } as never),
      onSettingsChanged
    })
    const next = {
      unusedDays: 90,
      setupComplete: true,
      locale: 'pt-BR',
      scanCategories: { unusedApps: false }
    }
    const saved = await call('settings:set', next)
    expect(saved).toEqual(
      expect.objectContaining({
        locale: 'pt-BR',
        scanCategories: expect.objectContaining({ unusedApps: false, userCaches: true, largeFiles: false }),
        largeFileMinBytes: 500 * 1024 * 1024,
        downloadsMinDays: 30,
        downloadsMinBytes: 50 * 1024 * 1024,
        lowDiskAlert: { enabled: false, kind: 'percent', value: 10 },
        launchAtLogin: false,
        scanReminder: { enabled: false, intervalDays: 7 },
        neverTouchPaths: [],
        duplicateFolders: [],
        appearance: 'system'
      })
    )
    expect(mocks.saveSettings).toHaveBeenCalledWith(saved)
    expect(mocks.applyLaunchAtLogin).toHaveBeenCalledWith(false)
    expect(setLocale).toHaveBeenCalledWith('pt-BR')
    expect(onSettingsChanged).toHaveBeenCalledWith(saved)
  })

  it('returns a chosen folder from the native picker', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Users/test/Keep'] })
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    await expect(call('dialog:pick-folder')).resolves.toBe('/Users/test/Keep')
    await expect(call('dialog:pick-folder')).resolves.toBeNull()
  })

  it('picks existing folders only, without createDirectory', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Users/test/Downloads', '/Users/test/Projects']
    })
    mocks.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    await expect(call('dialog:pick-folders')).resolves.toEqual([
      '/Users/test/Downloads',
      '/Users/test/Projects'
    ])
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory', 'multiSelections']
    })
    await expect(call('dialog:pick-folders')).resolves.toEqual([])
  })

  it('persists launch-at-login and scan-reminder flags and applies the login API', async () => {
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    const saved = await call('settings:set', {
      unusedDays: 90,
      setupComplete: true,
      locale: 'en',
      scanCategories: {},
      largeFileMinBytes: 250 * 1024 * 1024,
      downloadsMinDays: 60,
      downloadsMinBytes: 100 * 1024 * 1024,
      launchAtLogin: true,
      scanReminder: { enabled: true, intervalDays: 14 },
      appearance: 'light'
    })
    expect(saved).toEqual(
      expect.objectContaining({
        appearance: 'light',
        largeFileMinBytes: 250 * 1024 * 1024,
        downloadsMinDays: 60,
        downloadsMinBytes: 100 * 1024 * 1024,
        launchAtLogin: true,
        scanReminder: { enabled: true, intervalDays: 14 }
      })
    )
    expect(mocks.applyLaunchAtLogin).toHaveBeenCalledWith(true)
  })

  it('stores scan sizes, forwards progress and cleans known paths', async () => {
    const sendToRenderer = vi.fn()
    const onScanCompleted = vi.fn()
    mocks.runScan.mockImplementation(async (_days, onProgress) => {
      onProgress({ phase: 'progress.done', percent: 100 })
      return {
        items: [{ path: '/Users/test/cache', bytes: 42 }],
        scannedAt: '2025-01-01',
        limited: false
      }
    })
    mocks.trashPaths.mockResolvedValue({ trashed: [], failed: [], bytesRequested: 42 })
    registerIpc({ sendToRenderer, getTrayController: () => null, onScanCompleted })

    await call('scan:run', {
      unusedDays: 90,
      categories: { unusedApps: false },
      largeFileMinBytes: 100 * 1024 * 1024,
      downloadsMinDays: 7,
      downloadsMinBytes: 10 * 1024 * 1024
    })
    expect(onScanCompleted).toHaveBeenCalledTimes(1)
    expect(onScanCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [{ path: '/Users/test/cache', bytes: 42 }]
      })
    )
    expect(sendToRenderer).toHaveBeenCalledWith('scan:progress', {
      phase: 'progress.done',
      percent: 100
    })
    expect(mocks.runScan).toHaveBeenCalledWith(
      expect.objectContaining({
        unusedDays: 90,
        categories: expect.objectContaining({ unusedApps: false, userCaches: true }),
        largeFileMinBytes: 100 * 1024 * 1024,
        downloadsMinDays: 7,
        downloadsMinBytes: 10 * 1024 * 1024,
        duplicateFolders: [],
        neverTouchPaths: []
      }),
      expect.any(Function)
    )
    const request = { paths: ['/Users/test/cache', '/Users/test/unknown'] }
    await call('clean:trash', request)
    expect(mocks.trashPaths).toHaveBeenCalledWith(
      request,
      new Map([
        ['/Users/test/cache', 42],
        ['/Users/test/unknown', 0]
      ]),
      expect.objectContaining({
        lastScanPaths: new Set(['/Users/test/cache']),
        neverTouchPaths: [],
        lastScanItems: [{ path: '/Users/test/cache', bytes: 42 }]
      })
    )
  })

  it('passes persisted never-touch prefixes into scan and trash', async () => {
    mocks.loadSettings.mockResolvedValue({
      neverTouchPaths: ['/Users/test/Library/Caches/keep'],
      duplicateFolders: ['/Users/test/Downloads']
    })
    mocks.runScan.mockResolvedValue({
      items: [{ path: '/Users/test/cache', bytes: 8 }],
      scannedAt: '2025-01-01',
      limited: false
    })
    mocks.trashPaths.mockResolvedValue({ trashed: [], failed: [], bytesRequested: 0 })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })

    await call('scan:run', { unusedDays: 90 })
    expect(mocks.runScan).toHaveBeenCalledWith(
      expect.objectContaining({
        unusedDays: 90,
        categories: expect.any(Object),
        neverTouchPaths: ['/Users/test/Library/Caches/keep'],
        duplicateFolders: ['/Users/test/Downloads']
      }),
      expect.any(Function)
    )
    await call('clean:trash', { paths: ['/Users/test/cache'] })
    expect(mocks.trashPaths).toHaveBeenCalledWith(
      { paths: ['/Users/test/cache'] },
      new Map([['/Users/test/cache', 8]]),
      expect.objectContaining({
        lastScanPaths: new Set(['/Users/test/cache']),
        neverTouchPaths: ['/Users/test/Library/Caches/keep']
      })
    )
  })

  it('allows paid scan walks only with a valid main-process entitlement', async () => {
    mocks.runScan.mockResolvedValue({ items: [], scannedAt: '2025-01-01', limited: false })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    const request = {
      unusedDays: 90,
      categories: { largeFiles: true, downloadsReview: true, duplicateFiles: true },
      largeFileMinBytes: 1024 * 1024 * 1024,
      downloadsMinDays: 14,
      downloadsMinBytes: 100 * 1024 * 1024
    }

    await call('scan:run', request)
    expect(mocks.getLicenseStatus).toHaveBeenCalledTimes(1)
    expect(mocks.runScan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categories: expect.objectContaining({
          largeFiles: false,
          downloadsReview: false,
          duplicateFiles: false
        }),
        downloadsMinDays: 14,
        downloadsMinBytes: 100 * 1024 * 1024
      }),
      expect.any(Function)
    )

    mocks.getLicenseStatus.mockResolvedValueOnce({ isPro: true })
    await call('scan:run', request)
    expect(mocks.runScan).toHaveBeenLastCalledWith(
      expect.objectContaining({
        categories: expect.objectContaining({
          largeFiles: true,
          downloadsReview: true,
          duplicateFiles: true
        })
      }),
      expect.any(Function)
    )
  })

  it('rejects unsanitized downloads thresholds on scan:run', async () => {
    mocks.runScan.mockResolvedValue({ items: [], scannedAt: '2025-01-01', limited: false })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    await call('scan:run', {
      unusedDays: 90,
      downloadsMinDays: -1,
      downloadsMinBytes: 999
    })
    expect(mocks.runScan).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadsMinDays: 30,
        downloadsMinBytes: 50 * 1024 * 1024
      }),
      expect.any(Function)
    )
  })

  it('copies text and only opens approved external URLs', async () => {
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    call('shell:copy-text', 'hello')
    expect(mocks.writeText).toHaveBeenCalledWith('hello')

    await call('shell:open-external', 'https://github.com/sponsors/nettonucci')
    await call('shell:open-external', 'https://github.com/nettonucci/diskheadroom')
    await call('shell:open-external', 'https://www.diskheadroom.com/en/pro')
    await call('shell:open-external', 'https://example.com')
    await call('shell:open-external', 'http://www.diskheadroom.com/en/pro')
    expect(mocks.openExternal).toHaveBeenCalledTimes(3)
  })

  it('reveals only paths from the current scan that pass the safety check', async () => {
    mocks.runScan.mockResolvedValue({
      items: [
        { path: '/Users/test/Library/Caches/a', bytes: 10 },
        { path: '/', bytes: 1 }
      ],
      scannedAt: '2025-01-01',
      limited: false
    })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })

    await expect(call('shell:reveal-item', '/Users/test/Library/Caches/a')).resolves.toBe(false)
    expect(mocks.showItemInFolder).not.toHaveBeenCalled()

    await call('scan:run', { unusedDays: 90 })
    await expect(call('shell:reveal-item', '/Users/test/Library/Caches/a')).resolves.toBe(true)
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/Users/test/Library/Caches/a')

    await expect(call('shell:reveal-item', '/etc/passwd')).resolves.toBe(false)
    await expect(call('shell:reveal-item', '/')).resolves.toBe(false)
    await expect(call('shell:reveal-item', 42)).resolves.toBe(false)
    expect(mocks.showItemInFolder).toHaveBeenCalledTimes(1)
  })

  it('reveals a never-touch path from settings without a scan', async () => {
    mocks.loadSettings.mockResolvedValue({
      neverTouchPaths: ['/Users/test/Library/Caches/keep']
    })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    await expect(call('shell:reveal-item', '/Users/test/Library/Caches/keep')).resolves.toBe(true)
    expect(mocks.showItemInFolder).toHaveBeenCalledWith('/Users/test/Library/Caches/keep')
  })

  it('exposes license status as a boolean and never returns the key', async () => {
    mocks.getLicenseStatus.mockResolvedValue({ isPro: false })
    mocks.activateLicense.mockResolvedValue({ isPro: true })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    await expect(call('license:status')).resolves.toEqual({ isPro: false })
    await expect(call('license:activate', 'dh1.fixture')).resolves.toEqual({ isPro: true })
    expect(mocks.activateLicense).toHaveBeenCalledWith('dh1.fixture')
    expect(mocks.getLicenseStatus).toHaveBeenCalled()
  })

  it('returns forecast status from main and never records through IPC', async () => {
    const snapshot = {
      entitled: true,
      kind: 'collecting',
      sampleCount: 1,
      daysUntilThreshold: null,
      daysCapped: false,
      predictedAt: null,
      lastScan: null
    }
    mocks.getForecastStatus.mockResolvedValue(snapshot)
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    await expect(call('forecast:status')).resolves.toEqual(snapshot)
    expect(mocks.handlers.has('forecast:record')).toBe(false)
  })

  it('forwards update check, download and install without silently installing', async () => {
    const snapshot = {
      phase: 'idle',
      currentVersion: '1.0.0',
      availableVersion: null,
      percent: null,
      error: null,
      offline: false
    }
    mocks.getUpdateStatus.mockReturnValue(snapshot)
    mocks.checkForAppUpdates.mockResolvedValue({ ...snapshot, phase: 'not-available' })
    mocks.downloadAppUpdate.mockResolvedValue({ ...snapshot, phase: 'ready', availableVersion: '1.1.0' })
    const sendToRenderer = vi.fn()
    registerIpc({ sendToRenderer, getTrayController: () => null })
    expect(mocks.attachUpdateListener).toHaveBeenCalled()
    mocks.attachUpdateListener.mock.calls[0][0]({ ...snapshot, phase: 'checking' })
    expect(sendToRenderer).toHaveBeenCalledWith('update:changed', expect.objectContaining({ phase: 'checking' }))
    expect(call('update:status')).toEqual(snapshot)
    await expect(call('update:check')).resolves.toEqual({ ...snapshot, phase: 'not-available' })
    await expect(call('update:download')).resolves.toEqual(
      expect.objectContaining({ phase: 'ready', availableVersion: '1.1.0' })
    )
    call('update:install')
    expect(mocks.installAppUpdate).toHaveBeenCalled()
  })
})
