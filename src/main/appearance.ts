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
  win?.setBackgroundColor(WINDOW_BACKGROUND[scheme])
}
