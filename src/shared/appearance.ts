export const APPEARANCE_OPTIONS = ['system', 'dark', 'light'] as const
export type Appearance = (typeof APPEARANCE_OPTIONS)[number]
export const DEFAULT_APPEARANCE: Appearance = 'system'

/** Vibrant window fill; the last two hex digits are alpha. */
export const WINDOW_BACKGROUND = {
  dark: '#1c1c1ecc',
  light: '#f5f5f7cc'
} as const

/** Opaque stand-in used when vibrancy cannot be captured. */
export const SCREENSHOT_BACKGROUND = {
  dark: '#1c1c1e',
  light: '#f5f5f7'
} as const

export function mergeAppearance(input: unknown): Appearance {
  if (input === 'dark' || input === 'light' || input === 'system') return input
  return DEFAULT_APPEARANCE
}

export function resolveColorScheme(
  appearance: Appearance,
  systemPrefersDark: boolean
): 'dark' | 'light' {
  if (appearance === 'dark' || appearance === 'light') return appearance
  return systemPrefersDark ? 'dark' : 'light'
}
