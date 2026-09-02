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
  activateLicense: vi.fn()
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
})

describe('IPC registration', () => {
  it('wires information and permission handlers', async () => {
    mocks.getDiskInfo.mockResolvedValue({ mount: '/' })
    mocks.getPermissionStatus.mockResolvedValue({ fullDiskAccess: true })
    mocks.getGrantTarget.mockReturnValue({ displayName: 'Disk Headroom' })
    mocks.loadSettings.mockResolvedValue({ locale: 'en' })

    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    expect(mocks.handlers.size).toBe(15)
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
        scanCategories: expect.objectContaining({ unusedApps: false, userCaches: true }),
        lowDiskAlert: { enabled: false, kind: 'percent', value: 10 },
        launchAtLogin: false,
        scanReminder: { enabled: false, intervalDays: 7 },
        neverTouchPaths: []
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

  it('persists launch-at-login and scan-reminder flags and applies the login API', async () => {
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    const saved = await call('settings:set', {
      unusedDays: 90,
      setupComplete: true,
      locale: 'en',
      scanCategories: {},
      launchAtLogin: true,
      scanReminder: { enabled: true, intervalDays: 14 }
    })
    expect(saved).toEqual(
      expect.objectContaining({
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

    await call('scan:run', 90, { unusedApps: false })
    expect(onScanCompleted).toHaveBeenCalledTimes(1)
    expect(sendToRenderer).toHaveBeenCalledWith('scan:progress', {
      phase: 'progress.done',
      percent: 100
    })
    expect(mocks.runScan).toHaveBeenCalledWith(
      90,
      expect.any(Function),
      expect.objectContaining({ unusedApps: false, userCaches: true }),
      []
    )
    const request = { paths: ['/Users/test/cache', '/Users/test/unknown'] }
    await call('clean:trash', request)
    expect(mocks.trashPaths).toHaveBeenCalledWith(
      request,
      new Map([
        ['/Users/test/cache', 42],
        ['/Users/test/unknown', 0]
      ]),
      {
        lastScanPaths: new Set(['/Users/test/cache']),
        neverTouchPaths: []
      }
    )
  })

  it('passes persisted never-touch prefixes into scan and trash', async () => {
    mocks.loadSettings.mockResolvedValue({
      neverTouchPaths: ['/Users/test/Library/Caches/keep']
    })
    mocks.runScan.mockResolvedValue({
      items: [{ path: '/Users/test/cache', bytes: 8 }],
      scannedAt: '2025-01-01',
      limited: false
    })
    mocks.trashPaths.mockResolvedValue({ trashed: [], failed: [], bytesRequested: 0 })
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })

    await call('scan:run', 90)
    expect(mocks.runScan).toHaveBeenCalledWith(
      90,
      expect.any(Function),
      expect.any(Object),
      ['/Users/test/Library/Caches/keep']
    )
    await call('clean:trash', { paths: ['/Users/test/cache'] })
    expect(mocks.trashPaths).toHaveBeenCalledWith(
      { paths: ['/Users/test/cache'] },
      new Map([['/Users/test/cache', 8]]),
      {
        lastScanPaths: new Set(['/Users/test/cache']),
        neverTouchPaths: ['/Users/test/Library/Caches/keep']
      }
    )
  })

  it('copies text and only opens approved external URLs', async () => {
    registerIpc({ sendToRenderer: vi.fn(), getTrayController: () => null })
    call('shell:copy-text', 'hello')
    expect(mocks.writeText).toHaveBeenCalledWith('hello')

    await call('shell:open-external', 'https://github.com/sponsors/nettonucci')
    await call('shell:open-external', 'https://github.com/nettonucci/diskheadroom')
    await call('shell:open-external', 'https://sandbox-checkout.paddle.com/')
    await call('shell:open-external', 'https://example.com')
    await call('shell:open-external', 'http://checkout.paddle.com/')
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

    await call('scan:run', 90)
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
})
