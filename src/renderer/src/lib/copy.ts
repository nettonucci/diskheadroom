import type { ScanCategoryFlag } from '../../../shared/constants'
import type { ScanCategoryId } from '../../../shared/types'
import type { TranslationKey } from '../../../shared/i18n'

export const CATEGORY_META: Record<
  ScanCategoryId,
  { title: TranslationKey; hint: TranslationKey }
> = {
  userCaches: {
    title: 'category.userCaches.title',
    hint: 'category.userCaches.hint'
  },
  userLogs: {
    title: 'category.userLogs.title',
    hint: 'category.userLogs.hint'
  },
  homebrewCache: {
    title: 'category.homebrewCache.title',
    hint: 'category.homebrewCache.hint'
  },
  packageManagerCaches: {
    title: 'category.packageManagerCaches.title',
    hint: 'category.packageManagerCaches.hint'
  },
  trash: {
    title: 'category.trash.title',
    hint: 'category.trash.hint'
  },
  xcodeDerivedData: {
    title: 'category.xcodeDerivedData.title',
    hint: 'category.xcodeDerivedData.hint'
  },
  iosDeviceSupport: {
    title: 'category.iosDeviceSupport.title',
    hint: 'category.iosDeviceSupport.hint'
  },
  xcodeArchives: {
    title: 'category.xcodeArchives.title',
    hint: 'category.xcodeArchives.hint'
  },
  unavailableSimulators: {
    title: 'category.unavailableSimulators.title',
    hint: 'category.unavailableSimulators.hint'
  },
  outdatedSimulators: {
    title: 'category.outdatedSimulators.title',
    hint: 'category.outdatedSimulators.hint'
  },
  coreSimulatorCaches: {
    title: 'category.coreSimulatorCaches.title',
    hint: 'category.coreSimulatorCaches.hint'
  },
  dockerDesktop: {
    title: 'category.dockerDesktop.title',
    hint: 'category.dockerDesktop.hint'
  },
  androidDevCaches: {
    title: 'category.androidDevCaches.title',
    hint: 'category.androidDevCaches.hint'
  },
  idleUserFolders: {
    title: 'category.idleUserFolders.title',
    hint: 'category.idleUserFolders.hint'
  },
  largeFiles: {
    title: 'category.largeFiles.title',
    hint: 'category.largeFiles.hint'
  },
  downloadsReview: {
    title: 'category.downloadsReview.title',
    hint: 'category.downloadsReview.hint'
  },
  duplicateFiles: {
    title: 'category.duplicateFiles.title',
    hint: 'category.duplicateFiles.hint'
  },
  unusedApps: {
    title: 'category.unusedApps.title',
    hint: 'category.unusedApps.hint'
  }
}

// A scan phase can produce several result categories, so the Settings list
// reuses the progress labels the user already sees while a scan runs.
export const SCAN_CATEGORY_LABELS: Record<ScanCategoryFlag, TranslationKey> = {
  userCaches: 'progress.userCaches',
  userLogs: 'progress.logs',
  homebrewCache: 'progress.homebrew',
  packageManagers: 'progress.packageManagers',
  trash: 'progress.trash',
  xcode: 'progress.xcode',
  androidDev: 'progress.androidDev',
  docker: 'progress.docker',
  idleUserFolders: 'progress.documentsDesktop',
  largeFiles: 'progress.largeFiles',
  downloadsReview: 'progress.downloads',
  duplicateFiles: 'progress.duplicates',
  unusedApps: 'progress.apps'
}

export const CATEGORY_WARNING: Partial<Record<ScanCategoryId, TranslationKey>> = {
  dockerDesktop: 'category.dockerDesktop.warning',
  outdatedSimulators: 'category.outdatedSimulators.warning',
  idleUserFolders: 'category.idleUserFolders.warning',
  largeFiles: 'category.largeFiles.warning',
  downloadsReview: 'category.downloadsReview.warning',
  duplicateFiles: 'category.duplicateFiles.warning'
}

export const NAV: { id: ViewId; label: TranslationKey }[] = [
  { id: 'dashboard', label: 'nav.scan' },
  { id: 'settings', label: 'nav.settings' }
]

export const SETTINGS_TABS = [
  { id: 'pro', label: 'settings.tab.pro' },
  { id: 'scan', label: 'settings.tab.scan' },
  { id: 'permissions', label: 'settings.tab.permissions' },
  { id: 'general', label: 'settings.tab.general' },
  { id: 'updates', label: 'settings.tab.updates' }
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id']
export type SettingsSection = 'permissions' | 'donate' | 'general'

export function tabForSection(section: SettingsSection): SettingsTab {
  return section === 'donate' ? 'pro' : section
}

// 'debug' is reachable only from the development-only nav button in App.tsx.
export type ViewId = 'dashboard' | 'settings' | 'results' | 'debug'
