import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CleanRequest,
  CleanResult,
  DiskInfo,
  GrantTarget,
  LowDiskDebugStatus,
  PermissionStatus,
  ScanProgress,
  ScanResult
} from '../shared/types'

export interface DebugApi {
  lowDiskStatus: () => Promise<LowDiskDebugStatus>
  simulateFreePercent: (percent: number | null) => Promise<LowDiskDebugStatus>
  runLowDiskCheck: () => Promise<LowDiskDebugStatus>
  resetLowDiskCooldown: () => Promise<LowDiskDebugStatus>
  sendLowDiskNotification: () => Promise<{ shown: boolean; status: LowDiskDebugStatus }>
}

// Dropped from the bundle on a production build, so a packaged app exposes no
// debug surface at all.
const debug: DebugApi | null = import.meta.env.DEV
  ? {
      lowDiskStatus: () => ipcRenderer.invoke('debug:low-disk-status'),
      simulateFreePercent: (percent) => ipcRenderer.invoke('debug:low-disk-simulate', percent),
      runLowDiskCheck: () => ipcRenderer.invoke('debug:low-disk-check'),
      resetLowDiskCooldown: () => ipcRenderer.invoke('debug:low-disk-reset'),
      sendLowDiskNotification: () => ipcRenderer.invoke('debug:low-disk-notify')
    }
  : null

const api = {
  getDiskInfo: (): Promise<DiskInfo> => ipcRenderer.invoke('disk:info'),
  getPermissions: (): Promise<PermissionStatus> => ipcRenderer.invoke('permissions:status'),
  openFullDiskAccess: (): Promise<void> => ipcRenderer.invoke('permissions:open-fda'),
  getGrantTarget: (): Promise<GrantTarget> => ipcRenderer.invoke('permissions:grant-target'),
  revealGrantTarget: (): Promise<void> => ipcRenderer.invoke('permissions:reveal-target'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', settings),
  runScan: (
    unusedDays: AppSettings['unusedDays'],
    categories: AppSettings['scanCategories'],
    downloadsMinDays?: number,
    downloadsMinBytes?: number
  ): Promise<ScanResult> =>
    ipcRenderer.invoke('scan:run', unusedDays, categories, downloadsMinDays, downloadsMinBytes),
  trashItems: (request: CleanRequest): Promise<CleanResult> =>
    ipcRenderer.invoke('clean:trash', request),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('shell:copy-text', text),
  revealItem: (path: string): Promise<boolean> => ipcRenderer.invoke('shell:reveal-item', path),
  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress): void => {
      callback(progress)
    }
    ipcRenderer.on('scan:progress', listener)
    return () => ipcRenderer.removeListener('scan:progress', listener)
  },
  onTrayScan: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('tray:scan', listener)
    return () => ipcRenderer.removeListener('tray:scan', listener)
  },
  onTrayDonate: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('tray:donate', listener)
    return () => ipcRenderer.removeListener('tray:donate', listener)
  },
  debug
}

export type DiskHeadroomApi = typeof api

contextBridge.exposeInMainWorld('diskheadroom', api)
