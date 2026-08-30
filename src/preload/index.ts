import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CleanRequest,
  CleanResult,
  DiskInfo,
  GrantTarget,
  PermissionStatus,
  ScanProgress,
  ScanResult
} from '../shared/types'

const api = {
  getDiskInfo: (): Promise<DiskInfo> => ipcRenderer.invoke('disk:info'),
  getPermissions: (): Promise<PermissionStatus> => ipcRenderer.invoke('permissions:status'),
  openFullDiskAccess: (): Promise<void> => ipcRenderer.invoke('permissions:open-fda'),
  getGrantTarget: (): Promise<GrantTarget> => ipcRenderer.invoke('permissions:grant-target'),
  revealGrantTarget: (): Promise<void> => ipcRenderer.invoke('permissions:reveal-target'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: (settings: AppSettings): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:set', settings),
  runScan: (unusedDays: AppSettings['unusedDays']): Promise<ScanResult> =>
    ipcRenderer.invoke('scan:run', unusedDays),
  trashItems: (request: CleanRequest): Promise<CleanResult> =>
    ipcRenderer.invoke('clean:trash', request),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('shell:copy-text', text),
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
  }
}

export type DiskHeadroomApi = typeof api

contextBridge.exposeInMainWorld('diskheadroom', api)
