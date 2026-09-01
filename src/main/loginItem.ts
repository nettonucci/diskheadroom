import { app } from 'electron'

export function applyLaunchAtLogin(enabled: boolean): void {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    })
  } catch {
    // Unpackaged Electron can reject login items; settings.json still persists.
  }
}

export function shouldShowWindowOnLaunch(): boolean {
  try {
    return !app.getLoginItemSettings().wasOpenedAtLogin
  } catch {
    return true
  }
}
