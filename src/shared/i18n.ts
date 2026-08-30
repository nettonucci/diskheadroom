import catalog from './languages.json'

export const LOCALES = ['en', 'pt-BR', 'es'] as const
export type Locale = (typeof LOCALES)[number]
export type TranslationKey = keyof (typeof catalog)['en']
export type TranslationValues = Record<string, string | number>
export type Translator = (key: TranslationKey, values?: TranslationValues) => string

const translations: Record<Locale, Record<TranslationKey, string>> = catalog

export function resolveLocale(value: string | null | undefined): Locale {
  const normalized = value?.toLowerCase() ?? ''
  if (normalized.startsWith('pt')) return 'pt-BR'
  if (normalized.startsWith('es')) return 'es'
  return 'en'
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  values: TranslationValues = {}
): string {
  const template = translations[locale]?.[key] ?? translations.en[key]
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]
    return value === undefined ? match : String(value)
  })
}

export function translator(locale: Locale): Translator {
  return (key: TranslationKey, values?: TranslationValues): string =>
    translate(locale, key, values)
}

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
  es: 'Español'
}
