import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, readdir, readlink, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import {
  DEFAULT_LARGE_FILE_MIN_BYTES,
  DEFAULT_SCAN_CATEGORIES,
  type LargeFileMinBytes,
  type ScanCategoryFlags,
  type UnusedDays
} from '../shared/constants'
import type { TranslationKey } from '../shared/i18n'
import type { ScanCategoryId, ScanItem, ScanProgress, ScanResult } from '../shared/types'
import { getPermissionStatus } from './permissions'

const execFileAsync = promisify(execFile)

const BLOCKED_PREFIXES = ['/System', '/usr/sbin', '/bin', '/sbin', '/private/var/db']

/** First-level Documents/Desktop children below this size stay off the list. */
const IDLE_USER_MIN_BYTES = 100 * 1024 * 1024
const IDLE_USER_LIMIT = 24

const LARGE_FILES_MAX_DEPTH = 6
const LARGE_FILES_MAX_DIRS = 2000
const LARGE_FILES_LIMIT = 50

/** Top-level ~/Library/Caches names scanned as Homebrew or package-manager leftovers. */
const USER_CACHE_SKIP = new Set([
  'CocoaPods',
  'Homebrew',
  'bun',
  'go-build',
  'npm',
  'pip',
  'pnpm',
  'uv',
  'Yarn',
  'yarn'
])

type ProgressFn = (progress: ScanProgress) => void

export async function runScan(
  unusedDays: UnusedDays,
  onProgress: ProgressFn,
  categories: ScanCategoryFlags = DEFAULT_SCAN_CATEGORIES,
  largeFileMinBytes: LargeFileMinBytes = DEFAULT_LARGE_FILE_MIN_BYTES
): Promise<ScanResult> {
  const items: ScanItem[] = []
  const perms = await getPermissionStatus()
  const home = homedir()

  // Progress still reports every phase, including the skipped ones: a bar that
  // jumps from 8% to 80% reads as a scan that broke rather than one that obeyed
  // the settings.
  onProgress({ phase: 'progress.userCaches', percent: 8 })
  if (categories.userCaches) {
    items.push(
      ...(await scanChildren(join(home, 'Library', 'Caches'), 'userCaches', true, false, 24))
    )
  }

  onProgress({ phase: 'progress.logs', percent: 22 })
  if (categories.userLogs) {
    items.push(...(await scanChildren(join(home, 'Library', 'Logs'), 'userLogs', true, false, 36)))
  }

  onProgress({ phase: 'progress.homebrew', percent: 38 })
  if (categories.homebrewCache) {
    items.push(
      ...(await scanIfExists(
        join(home, 'Library', 'Caches', 'Homebrew'),
        'homebrewCache',
        'category.homebrewCache.title',
        true,
        false
      ))
    )
  }

  onProgress({ phase: 'progress.packageManagers', percent: 44 })
  if (categories.packageManagers) {
    items.push(...(await scanPackageManagerCaches(home)))
  }

  onProgress({ phase: 'progress.trash', percent: 52 })
  if (categories.trash) {
    items.push(
      ...(await scanIfExists(join(home, '.Trash'), 'trash', 'category.trash.title', true, false))
    )
  }

  onProgress({ phase: 'progress.xcode', percent: 64 })
  if (categories.xcode) {
    items.push(...(await scanXcodeLeftovers(home)))
  }

  onProgress({ phase: 'progress.androidDev', percent: 68 })
  if (categories.androidDev) {
    items.push(...(await scanAndroidDevCaches(home)))
  }

  onProgress({ phase: 'progress.docker', percent: 72 })
  if (categories.docker) {
    items.push(...(await scanDockerDesktop(home)))
  }

  onProgress({ phase: 'progress.documentsDesktop', percent: 76 })
  if (categories.idleUserFolders) {
    items.push(...(await scanIdleUserFolders(home, unusedDays)))
  }

  onProgress({ phase: 'progress.largeFiles', percent: 80 })
  if (categories.largeFiles) {
    items.push(...(await scanLargeHomeFiles(home, largeFileMinBytes)))
  }

  onProgress({ phase: 'progress.apps', percent: 86 })
  if (categories.unusedApps) {
    items.push(...(await scanUnusedApps(unusedDays)))
  }

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
    if (USER_CACHE_SKIP.has(name)) continue
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

type PackageManagerRoot = { segments: string[]; nameKey: TranslationKey }

const PACKAGE_MANAGER_ROOTS: PackageManagerRoot[] = [
  { segments: ['.npm'], nameKey: 'category.packageManagerCaches.npm' },
  { segments: ['Library', 'Caches', 'npm'], nameKey: 'category.packageManagerCaches.npm' },
  { segments: ['Library', 'Caches', 'Yarn'], nameKey: 'category.packageManagerCaches.yarn' },
  { segments: ['.yarn', 'berry', 'cache'], nameKey: 'category.packageManagerCaches.yarn' },
  { segments: ['.cache', 'yarn'], nameKey: 'category.packageManagerCaches.yarn' },
  { segments: ['Library', 'Caches', 'pnpm'], nameKey: 'category.packageManagerCaches.pnpm' },
  { segments: ['Library', 'pnpm', 'store'], nameKey: 'category.packageManagerCaches.pnpm' },
  { segments: ['.local', 'share', 'pnpm', 'store'], nameKey: 'category.packageManagerCaches.pnpm' },
  { segments: ['.bun', 'install', 'cache'], nameKey: 'category.packageManagerCaches.bun' },
  { segments: ['Library', 'Caches', 'pip'], nameKey: 'category.packageManagerCaches.pip' },
  { segments: ['.cache', 'pip'], nameKey: 'category.packageManagerCaches.pip' },
  { segments: ['Library', 'Caches', 'uv'], nameKey: 'category.packageManagerCaches.uv' },
  { segments: ['.cache', 'uv'], nameKey: 'category.packageManagerCaches.uv' },
  { segments: ['.cargo', 'registry'], nameKey: 'category.packageManagerCaches.cargoRegistry' },
  { segments: ['.cargo', 'git'], nameKey: 'category.packageManagerCaches.cargoGit' },
  { segments: ['go', 'pkg', 'mod'], nameKey: 'category.packageManagerCaches.goModules' },
  { segments: ['Library', 'Caches', 'go-build'], nameKey: 'category.packageManagerCaches.goBuild' }
]

type XcodeLeftoverRoot = { segments: string[]; categoryId: ScanCategoryId; nameKey: TranslationKey }

/** Known leftover roots only — never ~/Library/Developer or the whole CoreSimulator tree. */
const XCODE_LEFTOVER_ROOTS: XcodeLeftoverRoot[] = [
  {
    segments: ['Library', 'Developer', 'Xcode', 'DerivedData'],
    categoryId: 'xcodeDerivedData',
    nameKey: 'category.xcodeDerivedData.title'
  },
  {
    segments: ['Library', 'Developer', 'Xcode', 'iOS DeviceSupport'],
    categoryId: 'iosDeviceSupport',
    nameKey: 'category.iosDeviceSupport.title'
  },
  {
    segments: ['Library', 'Developer', 'Xcode', 'Archives'],
    categoryId: 'xcodeArchives',
    nameKey: 'category.xcodeArchives.title'
  },
  {
    segments: ['Library', 'Developer', 'CoreSimulator', 'Caches'],
    categoryId: 'coreSimulatorCaches',
    nameKey: 'category.coreSimulatorCaches.title'
  }
]

const SIMULATOR_UDID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/
const SIMULATOR_RUNTIME = /SimRuntime\.([A-Za-z]+)-(\d+(?:-\d+)*)$/

type SimctlDevice = { udid?: string; name?: string; isAvailable?: boolean }
type SimctlList = { devices?: Record<string, SimctlDevice[]> }
type SimulatorRuntime = { platform: string; version: number[]; label: string }

async function scanXcodeLeftovers(home: string): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  for (const root of XCODE_LEFTOVER_ROOTS) {
    items.push(
      ...(await scanIfExists(
        join(home, ...root.segments),
        root.categoryId,
        root.nameKey,
        false,
        true
      ))
    )
  }
  items.push(...(await scanSimulatorDevices(home)))
  return items
}

async function scanSimulatorDevices(home: string): Promise<ScanItem[]> {
  const groups = await listSimulatorDevices()
  if (!groups) return []

  const newestPerPlatform = new Map<string, number[]>()
  for (const identifier of Object.keys(groups)) {
    const runtime = parseSimulatorRuntime(identifier)
    if (!runtime) continue
    const current = newestPerPlatform.get(runtime.platform)
    if (!current || compareVersions(runtime.version, current) > 0) {
      newestPerPlatform.set(runtime.platform, runtime.version)
    }
  }

  const items: ScanItem[] = []
  const seen = new Set<string>()
  for (const [identifier, devices] of Object.entries(groups)) {
    if (!Array.isArray(devices)) continue
    const runtime = parseSimulatorRuntime(identifier)
    for (const device of devices) {
      const udid = device.udid?.trim() ?? ''
      if (!SIMULATOR_UDID.test(udid) || seen.has(udid)) continue

      const unavailable = device.isAvailable !== true
      // A runtime the user still targets is never listed; only older ones are,
      // and even then they stay unchecked because they remain fully usable.
      const outdated =
        !unavailable &&
        runtime !== null &&
        compareVersions(runtime.version, newestPerPlatform.get(runtime.platform) ?? runtime.version) < 0
      if (!unavailable && !outdated) continue

      seen.add(udid)
      const path = join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices', udid)
      if (!isSafePath(path)) continue
      const bytes = await directorySize(path)
      if (bytes <= 0) continue

      const deviceName = device.name?.trim() || udid
      items.push({
        id: idFor(path),
        name: outdated && runtime ? `${deviceName} (${runtime.label})` : deviceName,
        path,
        categoryId: outdated ? 'outdatedSimulators' : 'unavailableSimulators',
        bytes,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: null,
        daysIdle: null
      })
    }
  }
  return items
}

async function listSimulatorDevices(): Promise<Record<string, SimctlDevice[]> | null> {
  let stdout = ''
  try {
    const result = await execFileAsync('xcrun', ['simctl', 'list', 'devices', '-j'])
    stdout = result.stdout
  } catch {
    return null
  }

  let parsed: SimctlList
  try {
    parsed = JSON.parse(stdout) as SimctlList
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const groups = parsed.devices
  if (!groups || typeof groups !== 'object' || Array.isArray(groups)) return null
  return groups
}

function parseSimulatorRuntime(identifier: string): SimulatorRuntime | null {
  const match = SIMULATOR_RUNTIME.exec(identifier)
  if (!match) return null
  const version = match[2].split('-').map(Number)
  if (version.some((part) => !Number.isFinite(part))) return null
  return { platform: match[1], version, label: `${match[1]} ${version.join('.')}` }
}

function compareVersions(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

type DockerDesktopRoot = { segments: string[]; nameKey: TranslationKey }

/** Documented Docker Desktop leftovers only — never the whole Containers bundle. */
const DOCKER_DESKTOP_ROOTS: DockerDesktopRoot[] = [
  {
    segments: ['Library', 'Containers', 'com.docker.docker', 'Data', 'vms', '0', 'data', 'Docker.raw'],
    nameKey: 'category.dockerDesktop.diskImage'
  },
  {
    segments: ['Library', 'Containers', 'com.docker.docker', 'Data', 'vms', '0', 'Docker.qcow2'],
    nameKey: 'category.dockerDesktop.diskImage'
  },
  {
    segments: ['Library', 'Containers', 'com.docker.docker', 'Data', 'vms', '0', 'data', 'Docker.qcow2'],
    nameKey: 'category.dockerDesktop.diskImage'
  },
  { segments: ['.docker', 'buildx'], nameKey: 'category.dockerDesktop.buildx' }
]

async function scanDockerDesktop(home: string): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  for (const root of DOCKER_DESKTOP_ROOTS) {
    items.push(
      ...(await scanIfExists(
        join(home, ...root.segments),
        'dockerDesktop',
        root.nameKey,
        false,
        true
      ))
    )
  }
  return items
}

async function scanPackageManagerCaches(home: string): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  for (const root of PACKAGE_MANAGER_ROOTS) {
    items.push(
      ...(await scanIfExists(
        join(home, ...root.segments),
        'packageManagerCaches',
        root.nameKey,
        false,
        true
      ))
    )
  }
  return items
}

type AndroidDevRoot = { segments: string[]; nameKey: TranslationKey }

/**
 * Known leftover roots only — never ~/Library/Android/sdk, ~/.android/avd,
 * or a home-wide search for build/ folders.
 */
const ANDROID_DEV_ROOTS: AndroidDevRoot[] = [
  { segments: ['.gradle', 'caches'], nameKey: 'category.androidDevCaches.gradle' },
  { segments: ['.gradle', 'wrapper', 'dists'], nameKey: 'category.androidDevCaches.gradleWrapper' },
  { segments: ['Library', 'Caches', 'CocoaPods'], nameKey: 'category.androidDevCaches.cocoapods' },
  { segments: ['.android', 'cache'], nameKey: 'category.androidDevCaches.androidCache' },
  { segments: ['Library', 'Android', 'sdk', '.temp'], nameKey: 'category.androidDevCaches.sdkTemp' },
  { segments: ['Library', 'Android', 'sdk', 'cache'], nameKey: 'category.androidDevCaches.sdkCache' }
]

async function scanAndroidDevCaches(home: string): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  for (const root of ANDROID_DEV_ROOTS) {
    items.push(
      ...(await scanIfExists(
        join(home, ...root.segments),
        'androidDevCaches',
        root.nameKey,
        false,
        true
      ))
    )
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

async function scanIdleUserFolders(home: string, unusedDays: UnusedDays): Promise<ScanItem[]> {
  const now = Date.now()
  const thresholdMs = unusedDays * 24 * 60 * 60 * 1000
  const items: ScanItem[] = []

  for (const folder of ['Documents', 'Desktop'] as const) {
    const root = join(home, folder)
    let names: string[] = []
    try {
      names = await readdir(root)
    } catch {
      continue
    }

    for (const name of names) {
      const path = join(root, name)
      if (!isSafePath(path)) continue

      let info
      try {
        info = await lstat(path)
      } catch {
        continue
      }
      if (info.isSymbolicLink()) continue
      if (!Number.isFinite(info.mtimeMs) || now - info.mtimeMs < thresholdMs) continue

      const bytes = await directorySize(path)
      if (bytes < IDLE_USER_MIN_BYTES) continue

      items.push({
        id: idFor(path),
        categoryId: 'idleUserFolders',
        name,
        path,
        bytes,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: new Date(info.mtimeMs).toISOString(),
        daysIdle: Math.floor((now - info.mtimeMs) / (24 * 60 * 60 * 1000))
      })
    }
  }

  return items.sort((left, right) => right.bytes - left.bytes).slice(0, IDLE_USER_LIMIT)
}

/**
 * Recursively scans under the user's home folder for files exceeding minBytes.
 * Depth, directory visits and returned item count are capped to keep the walk bounded.
 * Skips .Trash, .git, symlinks, and BLOCKED_PREFIXES.
 */
export async function scanLargeHomeFiles(
  home: string,
  minBytes: number = DEFAULT_LARGE_FILE_MIN_BYTES,
  maxDepth = LARGE_FILES_MAX_DEPTH,
  limit = LARGE_FILES_LIMIT
): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  const seen = new Set<string>()
  let visitedDirs = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || visitedDirs >= LARGE_FILES_MAX_DIRS) return

    let realDir = dir
    try {
      const lst = await lstat(dir)
      if (lst.isSymbolicLink()) {
        const link = await readlink(dir).catch(() => dir)
        realDir = isAbsolute(link) ? link : resolvePath(dirname(dir), link)
      }
    } catch {
      return
    }

    if (seen.has(realDir)) return
    seen.add(realDir)
    visitedDirs++

    let entries: string[] = []
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    for (const name of entries) {
      if (visitedDirs >= LARGE_FILES_MAX_DIRS) break
      if (name === '.Trash' || name === '.git') continue

      const fullPath = join(dir, name)
      if (
        BLOCKED_PREFIXES.some((prefix) => fullPath === prefix || fullPath.startsWith(`${prefix}/`))
      ) {
        continue
      }

      let info
      try {
        info = await lstat(fullPath)
      } catch {
        continue
      }

      if (info.isSymbolicLink()) {
        continue
      }

      if (info.isDirectory()) {
        await walk(fullPath, depth + 1)
      } else if (info.isFile()) {
        if (info.size >= minBytes && isSafePath(fullPath)) {
          let lastUsedAt: string | null = null
          let daysIdle: number | null = null
          if (Number.isFinite(info.mtimeMs)) {
            lastUsedAt = new Date(info.mtimeMs).toISOString()
            daysIdle = Math.max(
              0,
              Math.floor((Date.now() - info.mtimeMs) / (24 * 60 * 60 * 1000))
            )
          }

          items.push({
            id: idFor(fullPath),
            categoryId: 'largeFiles',
            name,
            path: fullPath,
            bytes: info.size,
            selectedByDefault: false,
            optional: true,
            lastUsedAt,
            daysIdle
          })
        }
      }
    }
  }

  await walk(home, 0)

  return items.sort((left, right) => right.bytes - left.bytes).slice(0, limit)
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
  const home = homedir()
  if (resolved === '/' || resolved === home) return false
  if (resolved === join(home, 'Documents') || resolved === join(home, 'Desktop')) return false
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
