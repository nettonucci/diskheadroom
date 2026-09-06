import { app } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { AppUpdateStatus } from '../shared/types'

type StatusListener = (status: AppUpdateStatus) => void

let listener: StatusListener | null = null
let wired = false
let status: AppUpdateStatus = packagedOnlyStatus()

function packagedOnlyStatus(): AppUpdateStatus {
  return {
    phase: 'packaged-only',
    currentVersion: '0.0.0',
    availableVersion: null,
    percent: null,
    error: null,
    offline: false
  }
}

function baseStatus(): AppUpdateStatus {
  return {
    phase: app.isPackaged ? 'idle' : 'packaged-only',
    currentVersion: app.getVersion(),
    availableVersion: null,
    percent: null,
    error: null,
    offline: false
  }
}

function emit(): void {
  listener?.(status)
}

export function isOfflineUpdateError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${error.name}` : String(error)
  return /enotfound|econnrefused|enetunreach|offline|net::err_|timed out|socket hung up/i.test(
    text
  )
}

function fail(error: unknown): AppUpdateStatus {
  const offline = isOfflineUpdateError(error)
  status = {
    ...status,
    phase: 'error',
    error: error instanceof Error ? error.message : String(error),
    offline
  }
  emit()
  return status
}

function configureUpdater(): void {
  if (wired) return
  wired = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.allowPrerelease = false
  autoUpdater.on('checking-for-update', () => {
    status = { ...status, phase: 'checking', error: null, offline: false }
    emit()
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    status = {
      ...status,
      phase: 'available',
      availableVersion: info.version,
      error: null,
      offline: false
    }
    emit()
  })
  autoUpdater.on('update-not-available', () => {
    status = {
      ...status,
      phase: 'not-available',
      availableVersion: null,
      error: null,
      offline: false
    }
    emit()
  })
  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    status = {
      ...status,
      phase: 'downloading',
      percent: Math.round(progress.percent)
    }
    emit()
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    status = {
      ...status,
      phase: 'ready',
      availableVersion: info.version,
      percent: 100,
      error: null,
      offline: false
    }
    emit()
  })
  autoUpdater.on('error', (error: Error) => {
    fail(error)
  })
}

export function attachUpdateListener(next: StatusListener | null): void {
  listener = next
}

/** Test helper: module state is otherwise sticky across Vitest cases. */
export function resetUpdateStateForTests(): void {
  listener = null
  wired = false
  status = packagedOnlyStatus()
}

export function getUpdateStatus(): AppUpdateStatus {
  if (!app.isPackaged) {
    status = { ...baseStatus(), currentVersion: app.getVersion() }
    return status
  }
  if (status.phase === 'packaged-only') {
    status = baseStatus()
  }
  return status
}

export async function checkForAppUpdates(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    status = getUpdateStatus()
    emit()
    return status
  }
  configureUpdater()
  status = { ...getUpdateStatus(), phase: 'checking', error: null, offline: false }
  emit()
  try {
    await autoUpdater.checkForUpdates()
    return status
  } catch (error) {
    return fail(error)
  }
}

export async function downloadAppUpdate(): Promise<AppUpdateStatus> {
  if (!app.isPackaged) {
    return getUpdateStatus()
  }
  configureUpdater()
  try {
    await autoUpdater.downloadUpdate()
    return status
  } catch (error) {
    return fail(error)
  }
}

export function installAppUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall()
}

export function startPackagedUpdateCheck(): void {
  if (!app.isPackaged) return
  void checkForAppUpdates()
}
