import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LARGE_FILE_MIN_BYTES,
  DEFAULT_UNUSED_DAYS,
  LARGE_FILE_MIN_BYTES_OPTIONS,
  DEFAULT_DOWNLOADS_MIN_DAYS,
  DOWNLOADS_MIN_DAYS_OPTIONS,
  DEFAULT_DOWNLOADS_MIN_BYTES,
  DOWNLOADS_MIN_BYTES_OPTIONS,
  MAX_DUPLICATE_FOLDERS,
  MAX_NEVER_TOUCH_PATHS,
  UNUSED_DAY_OPTIONS,
  isAllowedExternalUrl,
  mergeDownloadsMinBytes,
  mergeDownloadsMinDays,
  mergeDuplicateFolders,
  mergeLargeFileMinBytes,
  mergeNeverTouchPaths,
  mergeScanCategories,
  proCheckoutUrl
} from '../src/shared/constants'
import {
  DEFAULT_APPEARANCE,
  mergeAppearance,
  resolveColorScheme,
  WINDOW_BACKGROUND
} from '../src/shared/appearance'
import { gateProScanCategories, isProEntitled } from '../src/shared/entitlement'
import { LOCALES, LOCALE_NAMES, resolveLocale, translate, translator } from '../src/shared/i18n'
import { CATEGORY_META, NAV, SETTINGS_TABS, tabForSection } from '../src/renderer/src/lib/copy'
import { formatBytes, formatDate } from '../src/renderer/src/lib/format'

describe('shared helpers', () => {
  it.each([
    ['pt-BR', 'pt-BR'],
    ['PT_pt', 'pt-BR'],
    ['es-MX', 'es'],
    ['fr', 'en'],
    [null, 'en'],
    [undefined, 'en']
  ] as const)('resolves locale %s', (input, expected) => {
    expect(resolveLocale(input)).toBe(expected)
  })

  it('translates, interpolates and preserves unknown placeholders', () => {
    expect(translate('pt-BR', 'settings.days', { days: 30 })).toBe('30 dias')
    expect(translate('en', 'settings.days')).toContain('{days}')
    expect(translator('es')('nav.settings')).toBe('Ajustes')
    expect(translate('en', 'settings.updateCheck')).toBe('Check for updates')
    expect(translate('pt-BR', 'settings.tab.updates')).toBe('Atualizações')
    expect(translate('es', 'settings.tab.updates')).toBe('Actualizaciones')
    expect(translate('pt-BR', 'settings.updateCheck')).toBe('Procurar atualizações')
    expect(translate('es', 'settings.updateCheck')).toBe('Buscar actualizaciones')
    expect(translate('en', 'settings.updateOffline')).toContain('offline')
    expect(translate('en', 'settings.shortcuts.scan')).toContain('scan')
    expect(translate('pt-BR', 'settings.shortcutsTitle')).toBe('Atalhos de teclado')
    expect(translate('es', 'settings.shortcuts.filter')).toContain('filtro')
    expect(translate('en', 'forecast.title')).toBe('Headroom forecast')
    expect(translate('pt-BR', 'forecast.days', { days: 12 })).toContain('12')
    expect(translate('es', 'forecast.cta')).toContain('Pro')
  })

  it('keeps the same translation keys in every locale', async () => {
    const catalog = (await import('../src/shared/languages.json')).default
    expect(Object.keys(catalog['pt-BR']).sort()).toEqual(Object.keys(catalog.en).sort())
    expect(Object.keys(catalog.es).sort()).toEqual(Object.keys(catalog.en).sort())
  })

  it('exposes complete locale and navigation metadata', () => {
    expect(LOCALES).toEqual(['en', 'pt-BR', 'es'])
    expect(LOCALE_NAMES['pt-BR']).toContain('Português')
    expect(NAV).toHaveLength(2)
    expect(SETTINGS_TABS).toHaveLength(5)
    expect(SETTINGS_TABS[0]?.id).toBe('pro')
    expect(SETTINGS_TABS.map((item) => item.id)).toContain('updates')
    expect(tabForSection('donate')).toBe('pro')
    expect(tabForSection('permissions')).toBe('permissions')
    expect(Object.keys(CATEGORY_META)).toHaveLength(18)
    expect(UNUSED_DAY_OPTIONS).toContain(DEFAULT_UNUSED_DAYS)
    expect(LARGE_FILE_MIN_BYTES_OPTIONS).toContain(DEFAULT_LARGE_FILE_MIN_BYTES)
    expect(DOWNLOADS_MIN_DAYS_OPTIONS).toContain(DEFAULT_DOWNLOADS_MIN_DAYS)
    expect(DOWNLOADS_MIN_BYTES_OPTIONS).toContain(DEFAULT_DOWNLOADS_MIN_BYTES)
    expect(WINDOW_BACKGROUND.light).toBe('#f5f5f7cc')
  })

  it('merges appearance onto system and resolves the color scheme', () => {
    expect(mergeAppearance(undefined)).toBe(DEFAULT_APPEARANCE)
    expect(mergeAppearance('nope')).toBe('system')
    expect(mergeAppearance('light')).toBe('light')
    expect(mergeAppearance('dark')).toBe('dark')
    expect(resolveColorScheme('system', true)).toBe('dark')
    expect(resolveColorScheme('system', false)).toBe('light')
    expect(resolveColorScheme('light', true)).toBe('light')
    expect(resolveColorScheme('dark', false)).toBe('dark')
  })

  it('merges scan categories respecting defaults (paid finders off)', () => {
    expect(mergeScanCategories(undefined).unusedApps).toBe(true)
    expect(mergeScanCategories(undefined).largeFiles).toBe(false)
    expect(mergeScanCategories(undefined).downloadsReview).toBe(false)
    expect(mergeScanCategories(undefined).duplicateFiles).toBe(false)
    expect(mergeScanCategories(null).unusedApps).toBe(true)
    expect(mergeScanCategories(null).largeFiles).toBe(false)
    expect(mergeScanCategories('all' as never).unusedApps).toBe(true)
    expect(mergeScanCategories({ unusedApps: 'no' } as never).unusedApps).toBe(true)
    expect(
      mergeScanCategories({ unusedApps: false, largeFiles: true, downloadsReview: true, duplicateFiles: true })
    ).toMatchObject({
      unusedApps: false,
      largeFiles: true,
      downloadsReview: true,
      duplicateFiles: true,
      userCaches: true
    })
  })

  it('merges downloads min days and bytes onto the allowlists', () => {
    expect(mergeDownloadsMinDays(60)).toBe(60)
    expect(mergeDownloadsMinDays(0)).toBe(0)
    expect(mergeDownloadsMinDays('invalid' as never)).toBe(DEFAULT_DOWNLOADS_MIN_DAYS)
    expect(mergeDownloadsMinDays(-1)).toBe(DEFAULT_DOWNLOADS_MIN_DAYS)
    expect(mergeDownloadsMinBytes(10 * 1024 * 1024)).toBe(10 * 1024 * 1024)
    expect(mergeDownloadsMinBytes(0)).toBe(0)
    expect(mergeDownloadsMinBytes(999)).toBe(DEFAULT_DOWNLOADS_MIN_BYTES)
  })

  it('merges large file min bytes floor safely', () => {
    expect(mergeLargeFileMinBytes(undefined)).toBe(DEFAULT_LARGE_FILE_MIN_BYTES)
    expect(mergeLargeFileMinBytes(null as never)).toBe(DEFAULT_LARGE_FILE_MIN_BYTES)
    expect(mergeLargeFileMinBytes(100 * 1024 * 1024)).toBe(100 * 1024 * 1024)
    expect(mergeLargeFileMinBytes(9999 as never)).toBe(DEFAULT_LARGE_FILE_MIN_BYTES)
  })

  it('normalizes never-touch paths and caps the list', () => {
    expect(mergeNeverTouchPaths(undefined)).toEqual([])
    expect(mergeNeverTouchPaths(['/', 'relative', '/tmp/keep/', '/tmp/keep'])).toEqual(['/tmp/keep'])
    expect(mergeNeverTouchPaths(Array.from({ length: 60 }, (_, index) => `/tmp/p${index}`))).toHaveLength(
      MAX_NEVER_TOUCH_PATHS
    )
    expect(
      mergeDuplicateFolders(['/', 'relative', '/tmp/dupes/', '/tmp/dupes'])
    ).toEqual(['/tmp/dupes'])
    expect(
      mergeDuplicateFolders(Array.from({ length: 30 }, (_, index) => `/tmp/d${index}`))
    ).toHaveLength(MAX_DUPLICATE_FOLDERS)
  })

  it('allows only HTTPS GitHub and diskheadroom.com hosts', () => {
    expect(
      isAllowedExternalUrl('https://github.com/sponsors/nettonucci?frequency=one-time'),
    ).toBe(true)
    expect(isAllowedExternalUrl('https://www.diskheadroom.com/en/pro')).toBe(true)
    expect(isAllowedExternalUrl('https://diskheadroom.com/pt-BR/pro')).toBe(true)
    expect(isAllowedExternalUrl('http://www.diskheadroom.com/en/pro')).toBe(false)
    expect(isAllowedExternalUrl('https://example.com')).toBe(false)
    expect(isAllowedExternalUrl('https://evil.diskheadroom.com/')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pass@github.com/x')).toBe(false)
    expect(isAllowedExternalUrl('not-a-url')).toBe(false)
  })

  it('points the Pro checkout at the site page for the current language', () => {
    expect(proCheckoutUrl('en')).toBe('https://www.diskheadroom.com/en/pro')
    expect(proCheckoutUrl('pt-BR')).toBe('https://www.diskheadroom.com/pt-BR/pro')
    expect(proCheckoutUrl('es')).toBe('https://www.diskheadroom.com/es/pro')
  })

  it('treats only a true isPro flag as entitled', () => {
    expect(isProEntitled(true)).toBe(true)
    expect(isProEntitled(false)).toBe(false)
  })

  it('turns paid scan walks off unless the signed key is valid', () => {
    const requested = mergeScanCategories({ largeFiles: true, downloadsReview: true, duplicateFiles: true })
    expect(gateProScanCategories(requested, false)).toMatchObject({
      largeFiles: false,
      downloadsReview: false,
      duplicateFiles: false,
      userCaches: true
    })
    expect(gateProScanCategories(requested, true)).toMatchObject({
      largeFiles: true,
      downloadsReview: true,
      duplicateFiles: true
    })
  })
})

describe('formatting', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1 KB'],
    [1536, '2 KB'],
    [10 * 1024 ** 2, '10 MB'],
    [2 * 1024 ** 4, '2.0 TB']
  ])('formats %d bytes', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it('formats dates using the chosen locale', () => {
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('localized')
    expect(formatDate('2025-01-02T12:00:00Z', 'pt-BR')).toBe('localized')
    expect(Date.prototype.toLocaleDateString).toHaveBeenCalledWith('pt-BR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  })

  it('includes time when formatting a scan timestamp', () => {
    vi.spyOn(Date.prototype, 'toLocaleDateString').mockReturnValue('localized-time')
    expect(formatDate('2025-01-02T12:00:00Z', 'en', true)).toBe('localized-time')
    expect(Date.prototype.toLocaleDateString).toHaveBeenCalledWith('en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  })
})
