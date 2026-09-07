import { nativeTheme, type BrowserWindow } from 'electron'
import {
  resolveColorScheme,
  WINDOW_BACKGROUND,
  type Appearance
} from '../shared/appearance'

export function applyNativeAppearance(
  appearance: Appearance,
  win: BrowserWindow | null | undefined
): void {
  nativeTheme.themeSource = appearance
  const scheme = resolveColorScheme(appearance, nativeTheme.shouldUseDarkColors)
  // Quitting destroys the window while the nativeTheme listener is still
  // attached, and a destroyed window throws on any call.
  if (!win || win.isDestroyed()) return
  win.setBackgroundColor(WINDOW_BACKGROUND[scheme])
}
