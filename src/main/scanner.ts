import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, readlink, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import type { UnusedDays } from '../shared/constants'
import type { TranslationKey } from '../shared/i18n'
import type { ScanCategoryId, ScanItem, ScanProgress, ScanResult } from '../shared/types'
import { getPermissionStatus } from './permissions'

const execFileAsync = promisify(execFile)

const BLOCKED_PREFIXES = ['/System', '/usr/sbin', '/bin', '/sbin', '/private/var/db']

type ProgressFn = (progress: ScanProgress) => void

export async function runScan(unusedDays: UnusedDays, onProgress: ProgressFn): Promise<ScanResult> {
  const items: ScanItem[] = []
  const perms = await getPermissionStatus()
  const home = homedir()

  onProgress({ phase: 'progress.userCaches', percent: 8 })
  items.push(
    ...(await scanChildren(join(home, 'Library', 'Caches'), 'userCaches', true, false, 24))
  )

  onProgress({ phase: 'progress.logs', percent: 22 })
  items.push(...(await scanChildren(join(home, 'Library', 'Logs'), 'userLogs', true, false, 36)))

  onProgress({ phase: 'progress.homebrew', percent: 38 })
  items.push(
    ...(await scanIfExists(
      join(home, 'Library', 'Caches', 'Homebrew'),
      'homebrewCache',
      'category.homebrewCache.title',
      true,
      false
    ))
  )

  onProgress({ phase: 'progress.trash', percent: 48 })
  items.push(
    ...(await scanIfExists(join(home, '.Trash'), 'trash', 'category.trash.title', true, false))
  )

  onProgress({ phase: 'progress.xcode', percent: 60 })
  items.push(
    ...(await scanIfExists(
      join(home, 'Library', 'Developer', 'Xcode', 'DerivedData'),
      'xcodeDerivedData',
      'category.xcodeDerivedData.title',
      false,
      true
    )),
    ...(await scanIfExists(
      join(home, 'Library', 'Developer', 'Xcode', 'iOS DeviceSupport'),
      'iosDeviceSupport',
      'category.iosDeviceSupport.title',
      false,
      true
    ))
  )

  onProgress({ phase: 'progress.apps', percent: 78 })
  items.push(...(await scanUnusedApps(unusedDays)))

  onProgress({ phase: 'progress.done', percent: 100 })

  return {
    items: items.filter((item) => item.bytes > 0 && isSafePath(item.path)),
    scannedAt: new Date().toISOString(),
    limited: !perms.fullDiskAccess
  }
}

async function scanChildren(
  root: string,
  categoryId: ScanCategoryId,
  selectedByDefault: boolean,
  optional: boolean,
  limit: number
): Promise<ScanItem[]> {
  let names: string[] = []
  try {
    names = await readdir(root)
  } catch {
    return []
  }

  const items: ScanItem[] = []
  for (const name of names.slice(0, limit)) {
    if (name === 'Homebrew') continue
    const path = join(root, name)
    if (!isSafePath(path)) continue
    const bytes = await directorySize(path)
    if (bytes <= 0) continue
    items.push({
      id: idFor(path),
      categoryId,
      name,
      path,
      bytes,
      selectedByDefault,
      optional,
      lastUsedAt: null,
      daysIdle: null
    })
  }
  return items
}

async function scanIfExists(
  path: string,
  categoryId: ScanCategoryId,
  nameKey: TranslationKey,
  selectedByDefault: boolean,
  optional: boolean
): Promise<ScanItem[]> {
  if (!isSafePath(path)) return []
  const bytes = await directorySize(path)
  if (bytes <= 0) return []
  return [
    {
      id: idFor(path),
      name: '',
      nameKey,
      path,
      categoryId,
      bytes,
      selectedByDefault,
      optional,
      lastUsedAt: null,
      daysIdle: null
    }
  ]
}

async function scanUnusedApps(unusedDays: UnusedDays): Promise<ScanItem[]> {
  const roots = ['/Applications', join(homedir(), 'Applications')]
  const now = Date.now()
  const thresholdMs = unusedDays * 24 * 60 * 60 * 1000
  const items: ScanItem[] = []

  for (const root of roots) {
    let entries: string[] = []
    try {
      entries = await readdir(root)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.endsWith('.app')) continue
      const path = join(root, entry)
      if (!isSafePath(path)) continue
      if (entry === 'Disk Headroom.app') continue

      const bundleId = await readPlistValue(path, 'CFBundleIdentifier')
      if (bundleId.startsWith('com.apple.')) continue

      const lastUsed = await lastUsedDate(path)
      const daysIdle =
        lastUsed === null ? unusedDays + 1 : Math.floor((now - lastUsed.getTime()) / (24 * 60 * 60 * 1000))

      if (lastUsed !== null && now - lastUsed.getTime() < thresholdMs) continue
      if (lastUsed === null) {
        // Spotlight has no last-used date — treat as idle only past the threshold from mtime
        const st = await stat(path).catch(() => null)
        if (st && now - st.mtimeMs < thresholdMs) continue
      }

      const bytes = await directorySize(path)
      if (bytes <= 0) continue

      const display = entry.replace(/\.app$/i, '')
      items.push({
        id: idFor(path),
        categoryId: 'unusedApps',
        name: display,
        path,
        bytes,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: lastUsed ? lastUsed.toISOString() : null,
        daysIdle
      })
    }
  }

  return items
}

async function lastUsedDate(appPath: string): Promise<Date | null> {
  try {
    const { stdout } = await execFileAsync('mdls', ['-name', 'kMDItemLastUsedDate', '-raw', appPath])
    const value = stdout.trim()
    if (!value || value === '(null)') return null
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  } catch {
    return null
  }
}

async function readPlistValue(appPath: string, key: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('defaults', [
      'read',
      join(appPath, 'Contents', 'Info'),
      key
    ])
    return stdout.trim()
  } catch {
    return ''
  }
}

export function isSafePath(target: string): boolean {
  const resolved = resolvePath(target)
  if (resolved === '/' || resolved === homedir()) return false
  return !BLOCKED_PREFIXES.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`))
}

async function directorySize(path: string): Promise<number> {
  const seen = new Set<string>()
  return walkSize(path, seen, 0)
}

async function walkSize(path: string, seen: Set<string>, depth: number): Promise<number> {
  if (depth > 28) return 0
  let real = path
  try {
    const lst = await lstat(path)
    if (lst.isSymbolicLink()) {
      const link = await readlink(path).catch(() => path)
      real = isAbsolute(link) ? link : resolvePath(dirname(path), link)
    }
  } catch {
    return 0
  }

  if (seen.has(real)) return 0
  seen.add(real)

  let info
  try {
    info = await lstat(path)
  } catch {
    return 0
  }

  if (info.isSymbolicLink()) return 0
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0

  let total = 0
  let children: string[] = []
  try {
    children = await readdir(path)
  } catch {
    return 0
  }

  for (const child of children) {
    total += await walkSize(join(path, child), seen, depth + 1)
  }
  return total
}

function idFor(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 16)
}
