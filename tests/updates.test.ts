import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isPackaged: false,
  getVersion: vi.fn(() => '1.19.0'),
  autoDownload: true,
  autoInstallOnAppQuit: true,
  allowPrerelease: true,
  handlers: new Map<string, (...args: unknown[]) => void>(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
    getVersion: mocks.getVersion
  }
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    get autoDownload() {
      return mocks.autoDownload
    },
    set autoDownload(value: boolean) {
      mocks.autoDownload = value
    },
    get autoInstallOnAppQuit() {
      return mocks.autoInstallOnAppQuit
    },
    set autoInstallOnAppQuit(value: boolean) {
      mocks.autoInstallOnAppQuit = value
    },
    get allowPrerelease() {
      return mocks.allowPrerelease
    },
    set allowPrerelease(value: boolean) {
      mocks.allowPrerelease = value
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      mocks.handlers.set(event, handler)
    },
    checkForUpdates: mocks.checkForUpdates,
    downloadUpdate: mocks.downloadUpdate,
    quitAndInstall: mocks.quitAndInstall
  }
}))

import {
  attachUpdateListener,
  checkForAppUpdates,
  downloadAppUpdate,
  getUpdateStatus,
  installAppUpdate,
  isOfflineUpdateError,
  resetUpdateStateForTests,
  startPackagedUpdateCheck
} from '../src/main/updates'

describe('update service', () => {
  beforeEach(() => {
    mocks.isPackaged = false
    mocks.handlers.clear()
    mocks.checkForUpdates.mockReset()
    mocks.downloadUpdate.mockReset()
    mocks.quitAndInstall.mockReset()
    resetUpdateStateForTests()
  })

  it('classifies network failures as offline', () => {
    expect(isOfflineUpdateError(new Error('getaddrinfo ENOTFOUND github.com'))).toBe(true)
    expect(isOfflineUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(true)
    expect(isOfflineUpdateError(new Error('sha512 checksum mismatch'))).toBe(false)
  })

  it('stays idle in development and never talks to GitHub', async () => {
    mocks.isPackaged = false
    const status = await checkForAppUpdates()
    expect(status.phase).toBe('packaged-only')
    expect(mocks.checkForUpdates).not.toHaveBeenCalled()
    expect(getUpdateStatus().phase).toBe('packaged-only')
    await downloadAppUpdate()
    expect(mocks.downloadUpdate).not.toHaveBeenCalled()
    installAppUpdate()
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()
    startPackagedUpdateCheck()
    expect(mocks.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks GitHub Releases without auto-download', async () => {
    mocks.isPackaged = true
    mocks.checkForUpdates.mockImplementation(async () => {
      mocks.handlers.get('checking-for-update')?.()
      mocks.handlers.get('update-not-available')?.()
    })
    const listener = vi.fn()
    attachUpdateListener(listener)
    startPackagedUpdateCheck()
    await vi.waitFor(() => expect(mocks.checkForUpdates).toHaveBeenCalled())
    const status = await checkForAppUpdates()
    expect(mocks.autoDownload).toBe(false)
    expect(mocks.autoInstallOnAppQuit).toBe(false)
    expect(status.phase).toBe('not-available')
    expect(listener).toHaveBeenCalled()
  })

  it('surfaces an available version and download progress', async () => {
    mocks.isPackaged = true
    mocks.checkForUpdates.mockImplementation(async () => {
      mocks.handlers.get('update-available')?.({ version: '1.20.0' })
    })
    mocks.downloadUpdate.mockImplementation(async () => {
      mocks.handlers.get('download-progress')?.({ percent: 41.2 })
      mocks.handlers.get('update-downloaded')?.({ version: '1.20.0' })
    })
    await checkForAppUpdates()
    expect(getUpdateStatus()).toMatchObject({ phase: 'available', availableVersion: '1.20.0' })
    await downloadAppUpdate()
    expect(getUpdateStatus()).toMatchObject({
      phase: 'ready',
      availableVersion: '1.20.0',
      percent: 100
    })
    installAppUpdate()
    expect(mocks.quitAndInstall).toHaveBeenCalled()
  })

  it('keeps the app usable when GitHub is unreachable', async () => {
    mocks.isPackaged = true
    mocks.checkForUpdates.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'))
    const status = await checkForAppUpdates()
    expect(status.phase).toBe('error')
    expect(status.offline).toBe(true)
    expect(status.error).toContain('ENOTFOUND')
  })

  it('records a download error without quitting', async () => {
    mocks.isPackaged = true
    mocks.downloadUpdate.mockRejectedValue(new Error('sha512 checksum mismatch'))
    const status = await downloadAppUpdate()
    expect(status.phase).toBe('error')
    expect(status.offline).toBe(false)
    expect(mocks.quitAndInstall).not.toHaveBeenCalled()
  })

  it('records updater errors from the event bus', async () => {
    mocks.isPackaged = true
    mocks.checkForUpdates.mockImplementation(async () => {
      mocks.handlers.get('error')?.(new Error('net::ERR_NAME_NOT_RESOLVED'))
    })
    const status = await checkForAppUpdates()
    expect(status.offline).toBe(true)
    expect(status.phase).toBe('error')
  })
})
