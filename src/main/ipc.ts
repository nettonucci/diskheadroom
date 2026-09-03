import { clipboard, dialog, ipcMain, shell } from 'electron'
import { resolve as resolvePath } from 'node:path'
import {
  mergeLargeFileMinBytes,
  mergeLaunchAtLogin,
  mergeLowDiskAlert,
  mergeNeverTouchPaths,
  mergeScanCategories,
  mergeScanReminder,
  isAllowedExternalUrl
} from '../shared/constants'
import type { AppSettings, CleanRequest, ScanItem, ScanOptions } from '../shared/types'
import { trashPaths } from './cleaner'
import { getDiskInfo } from './disk'
import { applyLaunchAtLogin } from './loginItem'
import {
  getGrantTarget,
  getPermissionStatus,
  openFullDiskAccessSettings,
  revealGrantTarget
} from './permissions'
import { isSafePath, runScan } from './scanner'
import { activateLicense, getLicenseStatus } from './license'
import { loadSettings, saveSettings } from './settings'
import type { TrayController } from './tray'

interface IpcOptions {
  sendToRenderer: (channel: string, payload?: unknown) => void
  getTrayController: () => TrayController | null
  onSettingsChanged?: (settings: AppSettings) => void
  onScanCompleted?: () => void
}

export function registerIpc(options: IpcOptions): void {
  let lastItems = new Map<string, ScanItem>()

  ipcMain.handle('disk:info', () => getDiskInfo())
  ipcMain.handle('permissions:status', () => getPermissionStatus())
  ipcMain.handle('permissions:open-fda', () => openFullDiskAccessSettings())
  ipcMain.handle('permissions:grant-target', () => getGrantTarget())
  ipcMain.handle('permissions:reveal-target', () => revealGrantTarget())
  ipcMain.handle('dialog:pick-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
  ipcMain.handle('license:status', () => getLicenseStatus())
  ipcMain.handle('license:activate', (_event, key: unknown) => activateLicense(key))
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_event, next: AppSettings) => {
    const normalized: AppSettings = {
      ...next,
      scanCategories: mergeScanCategories(next.scanCategories),
      largeFileMinBytes: mergeLargeFileMinBytes(next.largeFileMinBytes),
      lowDiskAlert: mergeLowDiskAlert(next.lowDiskAlert),
      launchAtLogin: mergeLaunchAtLogin(next.launchAtLogin),
      scanReminder: mergeScanReminder(next.scanReminder),
      neverTouchPaths: mergeNeverTouchPaths(next.neverTouchPaths)
    }
    await saveSettings(normalized)
    applyLaunchAtLogin(normalized.launchAtLogin)
    options.getTrayController()?.setLocale(normalized.locale)
    options.onSettingsChanged?.(normalized)
    return normalized
  })
  ipcMain.handle(
    'scan:run',
    async (_event, input: ScanOptions) => {
      const settings = await loadSettings()
      const categories = mergeScanCategories(input?.categories)
      if (categories.largeFiles) {
        // Entitlement is verified from the signed key in main on every requested
        // home walk. Renderer state can only affect presentation, never access.
        categories.largeFiles = (await getLicenseStatus()).isPro
      }
      const result = await runScan(
        {
          unusedDays: input?.unusedDays,
          categories,
          largeFileMinBytes: mergeLargeFileMinBytes(input?.largeFileMinBytes),
          neverTouchPaths: mergeNeverTouchPaths(settings.neverTouchPaths)
        },
        (progress) => {
          options.sendToRenderer('scan:progress', progress)
        }
      )
      lastItems = new Map(result.items.map((item) => [item.path, item]))
      options.onScanCompleted?.()
      return result
    }
  )
  ipcMain.handle('clean:trash', async (_event, request: CleanRequest) => {
    const settings = await loadSettings()
    const sizes = new Map<string, number>()
    for (const path of request.paths) {
      sizes.set(path, lastItems.get(path)?.bytes ?? 0)
    }
    return trashPaths(request, sizes, {
      lastScanPaths: new Set(lastItems.keys()),
      neverTouchPaths: mergeNeverTouchPaths(settings.neverTouchPaths)
    })
  })
  ipcMain.handle('shell:copy-text', (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('shell:reveal-item', async (_event, itemPath: unknown) => {
    if (typeof itemPath !== 'string' || !isSafePath(itemPath)) {
      return false
    }
    const settings = await loadSettings()
    const neverTouch = mergeNeverTouchPaths(settings.neverTouchPaths)
    const resolved = resolvePath(itemPath)
    const listed = neverTouch.some((prefix) => resolved === resolvePath(prefix))
    if (!lastItems.has(itemPath) && !listed) {
      return false
    }
    shell.showItemInFolder(itemPath)
    return true
  })
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (isAllowedExternalUrl(url)) {
      return shell.openExternal(url)
    }
    return Promise.resolve()
  })
}
