import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import type { GrantTarget, PermissionStatus } from '../shared/types'

// Both files are readable only by a process holding Full Disk Access.
const FULL_DISK_PROBES = [
  join(homedir(), 'Library', 'Application Support', 'com.apple.TCC', 'TCC.db'),
  '/Library/Application Support/com.apple.TCC/TCC.db'
]

const OWN_BUNDLE_ID = 'com.nettonucci.diskheadroom'

const KNOWN_LAUNCHERS: Record<string, string> = {
  'com.apple.Terminal': 'Terminal',
  'com.googlecode.iterm2': 'iTerm2',
  'com.microsoft.VSCode': 'Visual Studio Code',
  'com.todesktop.230313mzl4w4u92': 'Cursor',
  'dev.warp.Warp-Stable': 'Warp'
}

export async function getPermissionStatus(): Promise<PermissionStatus> {
  const libraryCaches = join(homedir(), 'Library', 'Caches')
  const probes = await Promise.all(FULL_DISK_PROBES.map(canRead))

  return {
    fullDiskAccess: probes.some(Boolean),
    libraryCachesReadable: await canList(libraryCaches),
    applicationsReadable: await canList('/Applications')
  }
}

export async function openFullDiskAccessSettings(): Promise<void> {
  const urls = [
    'x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
  ]

  for (const url of urls) {
    try {
      await shell.openExternal(url)
      return
    } catch {
      continue
    }
  }

  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security')
}

// macOS grants Full Disk Access to the running bundle, which in development is
// Electron.app inside node_modules rather than the product name.
export function getGrantTarget(): GrantTarget {
  const bundlePath = enclosingBundle(app.getPath('exe'))
  return {
    displayName: basename(bundlePath, '.app'),
    bundlePath,
    packaged: app.isPackaged,
    launchedBy: responsibleApp()
  }
}

function responsibleApp(): string | null {
  const id = process.env['__CFBundleIdentifier']
  if (!id || id === OWN_BUNDLE_ID) return null
  return KNOWN_LAUNCHERS[id] ?? id
}

export function revealGrantTarget(): void {
  shell.showItemInFolder(getGrantTarget().bundlePath)
}

function enclosingBundle(execPath: string): string {
  const marker = execPath.lastIndexOf('.app/')
  if (marker === -1) return execPath
  return execPath.slice(0, marker + 4)
}

// access() only consults POSIX bits, so open the file to make TCC answer.
async function canRead(path: string): Promise<boolean> {
  try {
    const handle = await open(path, 'r')
    await handle.close()
    return true
  } catch {
    return false
  }
}

async function canList(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}
