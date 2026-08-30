import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_UNUSED_DAYS } from '../shared/constants'
import { resolveLocale } from '../shared/i18n'
import type { AppSettings } from '../shared/types'

const filePath = (): string => join(app.getPath('userData'), 'settings.json')

const defaults = (): AppSettings => ({
  unusedDays: DEFAULT_UNUSED_DAYS,
  setupComplete: false,
  locale: resolveLocale(app.getLocale())
})

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(filePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      ...defaults(),
      ...parsed,
      locale: parsed.locale ? resolveLocale(parsed.locale) : defaults().locale
    }
  } catch {
    return defaults()
  }
}

export async function saveSettings(next: AppSettings): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeFile(filePath(), JSON.stringify(next, null, 2), 'utf8')
}
