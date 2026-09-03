import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LARGE_FILE_MIN_BYTES,
  DEFAULT_UNUSED_DAYS,
  LARGE_FILE_MIN_BYTES_OPTIONS,
  DEFAULT_DOWNLOADS_MIN_DAYS,
  DOWNLOADS_MIN_DAYS_OPTIONS,
  DEFAULT_DOWNLOADS_MIN_BYTES,
  DOWNLOADS_MIN_BYTES_OPTIONS,
  MAX_NEVER_TOUCH_PATHS,
  UNUSED_DAY_OPTIONS,
  isAllowedExternalUrl,
  mergeDownloadsMinBytes,
  mergeDownloadsMinDays,
  mergeLargeFileMinBytes,
  mergeNeverTouchPaths,
  mergeScanCategories,
  proCheckoutUrl
} from '../src/shared/constants'
import { gateProScanCategories, isProEntitled } from '../src/shared/entitlement'
import { LOCALES, LOCALE_NAMES, resolveLocale, translate, translator } from '../src/shared/i18n'
import { CATEGORY_META, NAV } from '../src/renderer/src/lib/copy'
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
  })

  it('exposes complete locale and navigation metadata', () => {
    expect(LOCALES).toEqual(['en', 'pt-BR', 'es'])
    expect(LOCALE_NAMES['pt-BR']).toContain('Português')
    expect(NAV).toHaveLength(4)
    expect(Object.keys(CATEGORY_META)).toHaveLength(17)
    expect(UNUSED_DAY_OPTIONS).toContain(DEFAULT_UNUSED_DAYS)
    expect(LARGE_FILE_MIN_BYTES_OPTIONS).toContain(DEFAULT_LARGE_FILE_MIN_BYTES)
    expect(DOWNLOADS_MIN_DAYS_OPTIONS).toContain(DEFAULT_DOWNLOADS_MIN_DAYS)
    expect(DOWNLOADS_MIN_BYTES_OPTIONS).toContain(DEFAULT_DOWNLOADS_MIN_BYTES)
  })

  it('merges scan categories respecting defaults (largeFiles and downloadsReview off)', () => {
    expect(mergeScanCategories(undefined).unusedApps).toBe(true)
    expect(mergeScanCategories(undefined).largeFiles).toBe(false)
    expect(mergeScanCategories(undefined).downloadsReview).toBe(false)
    expect(mergeScanCategories(null).unusedApps).toBe(true)
    expect(mergeScanCategories(null).largeFiles).toBe(false)
    expect(mergeScanCategories('all' as never).unusedApps).toBe(true)
    expect(mergeScanCategories({ unusedApps: 'no' } as never).unusedApps).toBe(true)
    expect(
      mergeScanCategories({ unusedApps: false, largeFiles: true, downloadsReview: true })
    ).toMatchObject({
      unusedApps: false,
      largeFiles: true,
      downloadsReview: true,
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
  })

  it('allows only HTTPS GitHub and diskheadroom.com hosts', () => {
    expect(isAllowedExternalUrl('https://github.com/sponsors/nettonucci')).toBe(true)
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
    const requested = mergeScanCategories({ largeFiles: true, downloadsReview: true })
    expect(gateProScanCategories(requested, false)).toMatchObject({
      largeFiles: false,
      downloadsReview: false,
      userCaches: true
    })
    expect(gateProScanCategories(requested, true)).toMatchObject({
      largeFiles: true,
      downloadsReview: true
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
