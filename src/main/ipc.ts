import { clipboard, ipcMain, shell } from 'electron'
import {
  mergeIsPro,
  mergeLaunchAtLogin,
  mergeLowDiskAlert,
  mergeScanCategories,
  mergeScanReminder,
  SPONSORS_URL
} from '../shared/constants'
import type { AppSettings, CleanRequest, ScanItem } from '../shared/types'
import { getApfsExplanation } from './apfs'
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
  ipcMain.handle('apfs:explanation', () => getApfsExplanation())
  ipcMain.handle('permissions:status', () => getPermissionStatus())
  ipcMain.handle('permissions:open-fda', () => openFullDiskAccessSettings())
  ipcMain.handle('permissions:grant-target', () => getGrantTarget())
  ipcMain.handle('permissions:reveal-target', () => revealGrantTarget())
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:set', async (_event, next: AppSettings) => {
    const normalized: AppSettings = {
      ...next,
      scanCategories: mergeScanCategories(next.scanCategories),
      lowDiskAlert: mergeLowDiskAlert(next.lowDiskAlert),
      launchAtLogin: mergeLaunchAtLogin(next.launchAtLogin),
      scanReminder: mergeScanReminder(next.scanReminder),
      isPro: mergeIsPro(next.isPro)
    }
    await saveSettings(normalized)
    applyLaunchAtLogin(normalized.launchAtLogin)
    options.getTrayController()?.setLocale(normalized.locale)
    options.onSettingsChanged?.(normalized)
    return normalized
  })
  ipcMain.handle(
    'scan:run',
    async (
      _event,
      unusedDays: AppSettings['unusedDays'],
      categories?: AppSettings['scanCategories']
    ) => {
      const result = await runScan(
        unusedDays,
        (progress) => {
          options.sendToRenderer('scan:progress', progress)
        },
        mergeScanCategories(categories)
      )
      lastItems = new Map(result.items.map((item) => [item.path, item]))
      options.onScanCompleted?.()
      return result
    }
  )
  ipcMain.handle('clean:trash', async (_event, request: CleanRequest) => {
    const sizes = new Map<string, number>()
    for (const path of request.paths) {
      sizes.set(path, lastItems.get(path)?.bytes ?? 0)
    }
    return trashPaths(request, sizes)
  })
  ipcMain.handle('shell:copy-text', (_event, text: string) => {
    clipboard.writeText(text)
  })
  ipcMain.handle('shell:reveal-item', (_event, itemPath: unknown) => {
    if (typeof itemPath !== 'string' || !lastItems.has(itemPath) || !isSafePath(itemPath)) {
      return false
    }
    shell.showItemInFolder(itemPath)
    return true
  })
  ipcMain.handle('shell:open-external', (_event, url: string) => {
    if (url === SPONSORS_URL || url.startsWith('https://github.com/')) {
      return shell.openExternal(url)
    }
    return Promise.resolve()
  })
}
