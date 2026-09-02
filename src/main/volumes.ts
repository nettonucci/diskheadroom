import { readdir, lstat, readlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { MountedVolume } from '../shared/types'

const IGNORED_VOLUME_NAMES = new Set([
  'Preboot',
  'Recovery',
  'VM',
  'Update',
  'Hardware',
  'com.apple.TimeMachine.localsnapshots'
])

/**
 * Lists mounted non-startup volumes available under /Volumes.
 */
export async function listMountedVolumes(): Promise<MountedVolume[]> {
  try {
    const entries = await readdir('/Volumes')
    const volumes: MountedVolume[] = []

    for (const entry of entries) {
      if (IGNORED_VOLUME_NAMES.has(entry) || entry.startsWith('.')) {
        continue
      }

      const fullPath = join('/Volumes', entry)
      try {
        const lst = await lstat(fullPath)
        if (lst.isSymbolicLink()) {
          const target = await readlink(fullPath)
          const resolved = resolve('/Volumes', target)
          if (resolved === '/' || resolved === '') {
            continue
          }
        }
        if (lst.isDirectory() || lst.isSymbolicLink()) {
          volumes.push({
            name: entry,
            path: fullPath
          })
        }
      } catch {
        continue
      }
    }

    return volumes
  } catch {
    return []
  }
}

/**
 * Opens a native folder selection dialog restricted to choosing an external volume directory.
 */
export async function pickExternalVolumeDialog(window?: BrowserWindow): Promise<string | null> {
  const result = window
    ? await dialog.showOpenDialog(window, {
        title: 'Select External Volume',
        defaultPath: '/Volumes',
        properties: ['openDirectory', 'dontAddToRecent']
      })
    : await dialog.showOpenDialog({
        title: 'Select External Volume',
        defaultPath: '/Volumes',
        properties: ['openDirectory', 'dontAddToRecent']
      })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0] ?? null
}
