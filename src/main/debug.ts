import { ipcMain } from 'electron'
import type { LowDiskDebugStatus } from '../shared/types'
import { deactivateLicense } from './license'
import type { LowDiskAlertWatcher } from './lowDiskAlert'

/**
 * Handlers behind the Debug tab. index.ts only calls this on an unpackaged run,
 * so a shipped build has no channel to answer these.
 */
export function registerDebugIpc(watcher: LowDiskAlertWatcher): void {
  const status = (): Promise<LowDiskDebugStatus> => watcher.getStatus()

  ipcMain.handle('debug:low-disk-status', status)
  ipcMain.handle('debug:low-disk-simulate', (_event, percent: unknown) => {
    watcher.simulateFreePercent(typeof percent === 'number' ? percent : null)
    return status()
  })
  ipcMain.handle('debug:low-disk-check', async () => {
    await watcher.checkNow()
    return status()
  })
  ipcMain.handle('debug:low-disk-reset', async () => {
    await watcher.resetCooldown()
    return status()
  })
  ipcMain.handle('debug:low-disk-notify', async () => {
    const shown = await watcher.notifyNow()
    return { shown, status: await status() }
  })
  // Testing a paid finder means seeing both sides of the gate. Activation needs a
  // signed key, so without this the only way back to the free state is deleting
  // the license file by hand.
  ipcMain.handle('debug:license-deactivate', () => deactivateLicense())
}
