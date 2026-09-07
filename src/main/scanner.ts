import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readdir, readlink, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { promisify } from 'node:util'
import {
  DEFAULT_DOWNLOADS_MIN_BYTES,
  DEFAULT_DOWNLOADS_MIN_DAYS,
  DEFAULT_DUPLICATE_FOLDERS,
  DEFAULT_LARGE_FILE_MIN_BYTES,
  DEFAULT_SCAN_CATEGORIES,
  type UnusedDays
} from '../shared/constants'
import type { TranslationKey } from '../shared/i18n'
import type {
  ScanCategoryId,
  ScanItem,
  ScanOptions,
  ScanProgress,
  ScanResult
} from '../shared/types'
import { getPermissionStatus } from './permissions'

const execFileAsync = promisify(execFile)

const BLOCKED_PREFIXES = ['/System', '/usr/sbin', '/bin', '/sbin', '/private/var/db']

/** First-level Documents/Desktop children below this size stay off the list. */
const IDLE_USER_MIN_BYTES = 100 * 1024 * 1024
const IDLE_USER_LIMIT = 24

/**
 * Every awaited filesystem call costs a full event loop turn, and in the
 * Electron main process a turn is milliseconds instead of microseconds. Walking
 * one entry at a time made a 21k-file app take 200s, so the walks keep a batch
 * of calls in flight and share a single turn between them.
 */
const WALK_BATCH = 64
const WALK_MAX_DEPTH = 28
/** Sibling trees measured at once, so their walks share turns too. */
const CHILD_SIZE_BATCH = 8

/** Bounded-concurrency map that keeps the input order of the results. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await work(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

const LARGE_FILES_MAX_DEPTH = 6
const LARGE_FILES_MAX_DIRS = 2000
const LARGE_FILES_LIMIT = 50
const DOWNLOADS_LIMIT = 50
const DUPLICATE_FILES_LIMIT = 50
const DUPLICATE_FILES_MAX_DEPTH = 8
const DUPLICATE_FILES_MAX_DIRS = 2000
const DUPLICATE_FILES_MAX_FILES = 10000

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

export interface ScanRunOptions extends ScanOptions {
  /** Main-process-only exclusions loaded from persisted settings. */
  neverTouchPaths?: string[]
}

export async function runScan(
  options: ScanRunOptions,
  onProgress: ProgressFn
): Promise<ScanResult> {
  const {
    unusedDays,
    categories = DEFAULT_SCAN_CATEGORIES,
    largeFileMinBytes = DEFAULT_LARGE_FILE_MIN_BYTES,
    downloadsMinDays = DEFAULT_DOWNLOADS_MIN_DAYS,
    downloadsMinBytes = DEFAULT_DOWNLOADS_MIN_BYTES,
    duplicateFolders = DEFAULT_DUPLICATE_FOLDERS,
    neverTouchPaths = []
  } = options
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

  onProgress({ phase: 'progress.downloads', percent: 83 })
  if (categories.downloadsReview) {
    items.push(...(await scanDownloads(home, downloadsMinDays, downloadsMinBytes)))
  }

  onProgress({ phase: 'progress.duplicates', percent: 84 })
  if (categories.duplicateFiles && duplicateFolders.length > 0) {
    items.push(...(await scanDuplicateFiles(duplicateFolders, neverTouchPaths)))
  }

  onProgress({ phase: 'progress.apps', percent: 86 })
  if (categories.unusedApps) {
    items.push(...(await scanUnusedApps(unusedDays)))
  }

  onProgress({ phase: 'progress.done', percent: 100 })

  return {
    items: items.filter(
      (item) =>
        item.bytes > 0 && isSafePath(item.path) && !isNeverTouchPath(item.path, neverTouchPaths)
    ),
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

  const candidates = names
    .slice(0, limit)
    .filter((name) => !USER_CACHE_SKIP.has(name) && isSafePath(join(root, name)))
  const sizes = await mapWithLimit(candidates, CHILD_SIZE_BATCH, (name) =>
    directorySize(join(root, name))
  )

  const items: ScanItem[] = []
  for (const [index, name] of candidates.entries()) {
    const bytes = sizes[index]
    if (bytes <= 0) continue
    const path = join(root, name)
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

    const safe = names.filter((name) => isSafePath(join(root, name)))
    const infos = await mapWithLimit(safe, WALK_BATCH, (name) =>
      lstat(join(root, name)).catch(() => null)
    )

    const idle = safe
      .map((name, index) => ({ name, info: infos[index] }))
      .filter(
        (entry) =>
          entry.info !== null &&
          !entry.info.isSymbolicLink() &&
          Number.isFinite(entry.info.mtimeMs) &&
          now - entry.info.mtimeMs >= thresholdMs
      )
    const sizes = await mapWithLimit(idle, CHILD_SIZE_BATCH, (entry) =>
      directorySize(join(root, entry.name))
    )

    for (const [index, entry] of idle.entries()) {
      const bytes = sizes[index]
      if (bytes < IDLE_USER_MIN_BYTES) continue
      const path = join(root, entry.name)
      const mtimeMs = entry.info!.mtimeMs

      items.push({
        id: idFor(path),
        categoryId: 'idleUserFolders',
        name: entry.name,
        path,
        bytes,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: new Date(mtimeMs).toISOString(),
        daysIdle: Math.floor((now - mtimeMs) / (24 * 60 * 60 * 1000))
      })
    }
  }

  return items.sort((left, right) => right.bytes - left.bytes).slice(0, IDLE_USER_LIMIT)
}

async function scanDownloads(
  home: string,
  minDays: number = DEFAULT_DOWNLOADS_MIN_DAYS,
  minBytes: number = DEFAULT_DOWNLOADS_MIN_BYTES
): Promise<ScanItem[]> {
  const root = join(home, 'Downloads')
  let names: string[] = []
  try {
    names = await readdir(root)
  } catch {
    return []
  }

  const now = Date.now()
  const thresholdMs = minDays * 24 * 60 * 60 * 1000
  const items: ScanItem[] = []

  for (const name of names) {
    if (name === '.DS_Store' || name === '.localized') continue
    const path = join(root, name)
    if (!isSafePath(path)) continue

    let info
    try {
      info = await lstat(path)
    } catch {
      continue
    }
    if (info.isSymbolicLink()) continue
    if (!Number.isFinite(info.mtimeMs)) continue
    if (minDays > 0 && now - info.mtimeMs < thresholdMs) continue

    const bytes = await directorySize(path)
    if (bytes < minBytes || bytes <= 0) continue

    items.push({
      id: idFor(path),
      categoryId: 'downloadsReview',
      name,
      path,
      bytes,
      selectedByDefault: false,
      optional: true,
      lastUsedAt: new Date(info.mtimeMs).toISOString(),
      daysIdle: Math.floor((now - info.mtimeMs) / (24 * 60 * 60 * 1000))
    })
  }

  return items.sort((left, right) => right.bytes - left.bytes).slice(0, DOWNLOADS_LIMIT)
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
  limit = LARGE_FILES_LIMIT,
  maxDirs = LARGE_FILES_MAX_DIRS
): Promise<ScanItem[]> {
  const items: ScanItem[] = []
  const seen = new Set<string>()
  let visitedDirs = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth || visitedDirs >= maxDirs) return

    try {
      const lst = await lstat(dir)
      if (lst.isSymbolicLink() || !lst.isDirectory()) return
    } catch {
      return
    }

    const realDir = resolvePath(dir)
    if (seen.has(realDir)) return
    seen.add(realDir)
    visitedDirs++

    let entries: string[] = []
    try {
      entries = await readdir(dir)
    } catch {
      return
    }

    const kept = entries.filter((name) => {
      if (name === '.Trash' || name === '.git') return false
      const fullPath = join(dir, name)
      return !BLOCKED_PREFIXES.some(
        (prefix) => fullPath === prefix || fullPath.startsWith(`${prefix}/`)
      )
    })
    const infos = await mapWithLimit(kept, WALK_BATCH, (name) =>
      lstat(join(dir, name)).catch(() => null)
    )

    for (const [index, name] of kept.entries()) {
      if (visitedDirs >= maxDirs) break

      const fullPath = join(dir, name)
      const info = infos[index]
      if (!info) continue

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

    const apps = entries.filter(
      (entry) =>
        entry.endsWith('.app') && entry !== 'Disk Headroom.app' && isSafePath(join(root, entry))
    )

    // Each app needs two subprocesses and a full tree walk; running a few side
    // by side keeps those awaits from serialising into one turn each.
    const idle = (
      await mapWithLimit(apps, CHILD_SIZE_BATCH, async (entry) => {
        const path = join(root, entry)
        const bundleId = await readPlistValue(path, 'CFBundleIdentifier')
        if (bundleId.startsWith('com.apple.')) return null

        const lastUsed = await lastUsedDate(path)
        const daysIdle =
          lastUsed === null
            ? unusedDays + 1
            : Math.floor((now - lastUsed.getTime()) / (24 * 60 * 60 * 1000))

        if (lastUsed !== null && now - lastUsed.getTime() < thresholdMs) return null
        if (lastUsed === null) {
          // Spotlight has no last-used date — treat as idle only past the threshold from mtime
          const st = await stat(path).catch(() => null)
          if (st && now - st.mtimeMs < thresholdMs) return null
        }

        return { entry, path, lastUsed, daysIdle }
      })
    ).filter((app): app is NonNullable<typeof app> => app !== null)

    const sizes = await mapWithLimit(idle, CHILD_SIZE_BATCH, (app) => directorySize(app.path))

    for (const [index, app] of idle.entries()) {
      const bytes = sizes[index]
      if (bytes <= 0) continue

      items.push({
        id: idFor(app.path),
        categoryId: 'unusedApps',
        name: app.entry.replace(/\.app$/i, ''),
        path: app.path,
        bytes,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: app.lastUsed ? app.lastUsed.toISOString() : null,
        daysIdle: app.daysIdle
      })
    }
  }

  return items
}

interface DuplicateCandidate {
  path: string
  name: string
  size: number
  mtimeMs: number
  hash?: string
}

export async function computeFileSha256(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => {
        hash.update(chunk)
      })
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
}

/** User-chosen roots may be Documents/Desktop/Downloads; those folders themselves stay unlistable as trash items. */
export function isAllowedDuplicateRoot(target: string): boolean {
  if (typeof target !== 'string' || !target.trim()) return false
  const resolved = resolvePath(target)
  const home = homedir()
  if (resolved === '/' || resolved === home) return false
  return !BLOCKED_PREFIXES.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`))
}

function shouldSkipDuplicateEntry(fullPath: string): boolean {
  const resolved = resolvePath(fullPath)
  const home = homedir()
  if (resolved === '/' || resolved === home) return true
  return BLOCKED_PREFIXES.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`))
}

export async function scanDuplicateFiles(
  folders: string[],
  neverTouchPaths: string[] = [],
  limit = DUPLICATE_FILES_LIMIT,
  maxDepth = DUPLICATE_FILES_MAX_DEPTH,
  maxDirs = DUPLICATE_FILES_MAX_DIRS,
  maxFiles = DUPLICATE_FILES_MAX_FILES
): Promise<ScanItem[]> {
  if (!Array.isArray(folders) || folders.length === 0) return []

  const candidates: DuplicateCandidate[] = []
  let totalDirsVisited = 0
  let totalFilesExamined = 0
  const visitedRealDirs = new Set<string>()

  async function walkDir(dirPath: string, depth: number): Promise<void> {
    if (depth > maxDepth || totalDirsVisited >= maxDirs || totalFilesExamined >= maxFiles) {
      return
    }
    if (isNeverTouchPath(dirPath, neverTouchPaths) || shouldSkipDuplicateEntry(dirPath)) return

    try {
      const lst = await lstat(dirPath)
      if (lst.isSymbolicLink() || !lst.isDirectory()) return
    } catch {
      return
    }

    const realPath = resolvePath(dirPath)
    if (visitedRealDirs.has(realPath)) return
    visitedRealDirs.add(realPath)
    totalDirsVisited++

    let entries: string[] = []
    try {
      entries = await readdir(dirPath)
    } catch {
      return
    }

    for (const entry of entries) {
      if (totalFilesExamined >= maxFiles || totalDirsVisited >= maxDirs) break
      if (entry.startsWith('.')) continue

      const fullPath = join(dirPath, entry)
      if (isNeverTouchPath(fullPath, neverTouchPaths) || shouldSkipDuplicateEntry(fullPath)) continue

      try {
        const st = await lstat(fullPath)
        if (st.isSymbolicLink()) continue

        if (st.isDirectory()) {
          await walkDir(fullPath, depth + 1)
        } else if (st.isFile()) {
          totalFilesExamined++
          if (st.size > 0 && isSafePath(fullPath)) {
            candidates.push({
              path: fullPath,
              name: entry,
              size: st.size,
              mtimeMs:
                typeof st.mtimeMs === 'number' && Number.isFinite(st.mtimeMs)
                  ? st.mtimeMs
                  : Date.now()
            })
          }
        }
      } catch {
        continue
      }
    }
  }

  for (const folder of folders) {
    if (typeof folder !== 'string' || !folder.trim() || !isAllowedDuplicateRoot(folder)) continue
    if (isNeverTouchPath(folder, neverTouchPaths)) continue
    await walkDir(resolvePath(folder), 0)
  }

  if (candidates.length < 2) return []

  const sizeMap = new Map<number, DuplicateCandidate[]>()
  for (const candidate of candidates) {
    const list = sizeMap.get(candidate.size)
    if (list) list.push(candidate)
    else sizeMap.set(candidate.size, [candidate])
  }

  const hashMap = new Map<string, DuplicateCandidate[]>()
  for (const [size, sameSizeCandidates] of sizeMap.entries()) {
    if (sameSizeCandidates.length < 2) continue
    for (const candidate of sameSizeCandidates) {
      const hash = await computeFileSha256(candidate.path)
      if (!hash) continue
      candidate.hash = hash
      const groupKey = `${size}:${hash}`
      const list = hashMap.get(groupKey)
      if (list) list.push(candidate)
      else hashMap.set(groupKey, [candidate])
    }
  }

  const duplicateGroups: DuplicateCandidate[][] = []
  for (const group of hashMap.values()) {
    if (group.length < 2) continue
    group.sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path))
    duplicateGroups.push(group)
  }

  duplicateGroups.sort((a, b) => b[0].size * (b.length - 1) - a[0].size * (a.length - 1))

  const now = Date.now()
  const items: ScanItem[] = []

  for (const group of duplicateGroups) {
    const duplicateGroupId = createHash('sha1')
      .update(`${group[0].size}:${group[0].hash ?? group[0].path}`)
      .digest('hex')
      .slice(0, 16)
    for (const [index, file] of group.entries()) {
      if (items.length >= limit) break
      const daysIdle = Math.max(0, Math.floor((now - file.mtimeMs) / (24 * 60 * 60 * 1000)))
      items.push({
        id: idFor(file.path),
        categoryId: 'duplicateFiles',
        name: file.name,
        path: file.path,
        bytes: file.size,
        selectedByDefault: false,
        optional: true,
        lastUsedAt: new Date(file.mtimeMs).toISOString(),
        daysIdle,
        duplicateGroupId,
        duplicateKeep: index === 0
      })
    }
    if (items.length >= limit) break
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
  if (
    resolved === join(home, 'Documents') ||
    resolved === join(home, 'Desktop') ||
    resolved === join(home, 'Downloads')
  ) {
    return false
  }
  return !BLOCKED_PREFIXES.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}/`))
}

/** True when `target` is the never-touch path itself or a descendant of one. */
export function isNeverTouchPath(target: string, prefixes: string[]): boolean {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false
  const resolved = resolvePath(target)
  return prefixes.some((raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return false
    const prefix = resolvePath(raw)
    return resolved === prefix || resolved.startsWith(`${prefix}/`)
  })
}

async function directorySize(path: string): Promise<number> {
  const seen = new Set<string>()
  return walkSize(path, seen)
}

/** Sums a tree one depth level at a time so each level shares an event loop turn. */
async function walkSize(root: string, seen: Set<string>): Promise<number> {
  let total = 0
  let level = [root]

  for (let depth = 0; depth <= WALK_MAX_DEPTH && level.length > 0; depth++) {
    const infos = await mapWithLimit(level, WALK_BATCH, (path) => lstat(path).catch(() => null))

    const links = level.filter((_, index) => infos[index]?.isSymbolicLink())
    const targets = await mapWithLimit(links, WALK_BATCH, (path) =>
      readlink(path).catch(() => path)
    )
    const linkTargets = new Map(links.map((path, index) => [path, targets[index]]))

    const dirs: string[] = []
    for (const [index, info] of infos.entries()) {
      if (!info) continue
      const path = level[index]

      // A symlink still claims its target so the same bytes are not counted
      // again when the walk reaches the real path.
      let real = path
      if (info.isSymbolicLink()) {
        const link = linkTargets.get(path) ?? path
        real = isAbsolute(link) ? link : resolvePath(dirname(path), link)
      }
      if (seen.has(real)) continue
      seen.add(real)

      if (info.isSymbolicLink()) continue
      if (info.isFile()) total += info.size
      else if (info.isDirectory()) dirs.push(path)
    }

    const children = await mapWithLimit(dirs, WALK_BATCH, (path) =>
      readdir(path).catch(() => [] as string[])
    )
    level = dirs.flatMap((path, index) => children[index].map((child) => join(path, child)))
  }

  return total
}

function idFor(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 16)
}
