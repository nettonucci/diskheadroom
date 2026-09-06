import { resolveColorScheme, type Appearance } from '../../../shared/appearance'

function systemPrefersDark(): boolean {
  if (typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function applyDocumentTheme(appearance: Appearance): () => void {
  const sync = (): void => {
    const theme = resolveColorScheme(appearance, systemPrefersDark())
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }
  sync()
  if (appearance !== 'system' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (): void => sync()
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
