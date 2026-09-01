export const SPONSORS_URL = 'https://github.com/sponsors/nettonucci'
export const REPO_URL = 'https://github.com/nettonucci/diskheadroom'
export const APP_NAME = 'Disk Headroom'

export const UNUSED_DAY_OPTIONS = [30, 90, 180, 365] as const
export type UnusedDays = (typeof UNUSED_DAY_OPTIONS)[number]
export const DEFAULT_UNUSED_DAYS: UnusedDays = 90

/** Scan phases the user can turn off. Order drives the Settings list. */
export const SCAN_CATEGORY_IDS = [
  'userCaches',
  'userLogs',
  'homebrewCache',
  'packageManagers',
  'trash',
  'xcode',
  'androidDev',
  'docker',
  'idleUserFolders',
  'unusedApps'
] as const
export type ScanCategoryFlag = (typeof SCAN_CATEGORY_IDS)[number]
export type ScanCategoryFlags = Record<ScanCategoryFlag, boolean>

export const DEFAULT_SCAN_CATEGORIES: ScanCategoryFlags = {
  userCaches: true,
  userLogs: true,
  homebrewCache: true,
  packageManagers: true,
  trash: true,
  xcode: true,
  androidDev: true,
  docker: true,
  idleUserFolders: true,
  unusedApps: true
}

// Settings saved before a phase existed omit its flag, and the renderer can send
// anything over IPC, so unknown or non-boolean values fall back to the default.
export function mergeScanCategories(
  input: Partial<ScanCategoryFlags> | null | undefined
): ScanCategoryFlags {
  const next = { ...DEFAULT_SCAN_CATEGORIES }
  if (!input || typeof input !== 'object') return next
  for (const id of SCAN_CATEGORY_IDS) {
    if (typeof input[id] === 'boolean') next[id] = input[id]
  }
  return next
}
