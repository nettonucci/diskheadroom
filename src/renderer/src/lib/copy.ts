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
  dockerDesktop: {
    title: 'category.dockerDesktop.title',
    hint: 'category.dockerDesktop.hint'
  },
  unusedApps: {
    title: 'category.unusedApps.title',
    hint: 'category.unusedApps.hint'
  }
}

export const NAV: { id: ViewId; label: TranslationKey }[] = [
  { id: 'dashboard', label: 'nav.scan' },
  { id: 'permissions', label: 'nav.permissions' },
  { id: 'settings', label: 'nav.settings' },
  { id: 'donate', label: 'nav.donate' }
]

export type ViewId = 'dashboard' | 'permissions' | 'settings' | 'donate' | 'results'
