import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_UNUSED_DAYS,
  UNUSED_DAY_OPTIONS,
  DEFAULT_DOWNLOADS_MIN_DAYS,
  DOWNLOADS_MIN_DAYS_OPTIONS,
  DEFAULT_DOWNLOADS_MIN_BYTES,
  DOWNLOADS_MIN_BYTES_OPTIONS,
  mergeDownloadsMinBytes,
  mergeDownloadsMinDays,
  mergeScanCategories
} from '../src/shared/constants'
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
    expect(Object.keys(CATEGORY_META)).toHaveLength(16)
    expect(UNUSED_DAY_OPTIONS).toContain(DEFAULT_UNUSED_DAYS)
    expect(DOWNLOADS_MIN_DAYS_OPTIONS).toContain(DEFAULT_DOWNLOADS_MIN_DAYS)
    expect(DOWNLOADS_MIN_BYTES_OPTIONS).toContain(DEFAULT_DOWNLOADS_MIN_BYTES)
  })

  it('merges downloads min days and bytes with fallback to defaults', () => {
    expect(mergeDownloadsMinDays(60)).toBe(60)
    expect(mergeDownloadsMinDays('invalid' as never)).toBe(DEFAULT_DOWNLOADS_MIN_DAYS)
    expect(mergeDownloadsMinDays(999 as never)).toBe(DEFAULT_DOWNLOADS_MIN_DAYS)

    expect(mergeDownloadsMinBytes(10 * 1024 * 1024)).toBe(10 * 1024 * 1024)
    expect(mergeDownloadsMinBytes('invalid' as never)).toBe(DEFAULT_DOWNLOADS_MIN_BYTES)
    expect(mergeDownloadsMinBytes(999 as never)).toBe(DEFAULT_DOWNLOADS_MIN_BYTES)
  })

  it('keeps default scan categories when flags are missing or malformed', () => {
    expect(mergeScanCategories(undefined).unusedApps).toBe(true)
    expect(mergeScanCategories(undefined).downloadsReview).toBe(false)
    expect(mergeScanCategories(null).unusedApps).toBe(true)
    expect(mergeScanCategories('all' as never).unusedApps).toBe(true)
    expect(mergeScanCategories({ unusedApps: 'no' } as never).unusedApps).toBe(true)
    expect(mergeScanCategories({ unusedApps: false, downloadsReview: true })).toMatchObject({
      unusedApps: false,
      downloadsReview: true,
      userCaches: true
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
