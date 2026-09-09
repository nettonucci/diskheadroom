import { BrowserWindow, Menu, nativeImage, nativeTheme, shell, app } from 'electron'
import { join } from 'node:path'
import { applyNativeAppearance } from './appearance'
import { APP_NAME } from '../shared/constants'
import { DEFAULT_APPEARANCE, resolveColorScheme, WINDOW_BACKGROUND, type Appearance } from '../shared/appearance'
import { registerIpc } from './ipc'
import { registerDebugIpc } from './debug'
import { applyLaunchAtLogin, shouldShowWindowOnLaunch } from './loginItem'
import { recordDiskSample, recordScanSample } from './headroomForecast'
import { startLowDiskAlertWatcher } from './lowDiskAlert'
import { startScanReminderWatcher } from './scanReminder'
import { loadSettings } from './settings'
import { createTray, type TrayController } from './tray'
import { startPackagedUpdateCheck } from './updates'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let trayController: TrayController | null = null
let currentAppearance: Appearance = DEFAULT_APPEARANCE

// A development run inherits Electron's bundle name, which then shows up in the
// menu bar, the About panel and the user-data folder. Must run before ready.
app.setName(APP_NAME)

function createWindow(showOnReady: boolean): void {
  nativeTheme.themeSource = currentAppearance
  const scheme = resolveColorScheme(currentAppearance, nativeTheme.shouldUseDarkColors)
  mainWindow = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 840,
    minHeight: 560,
    show: false,
    title: 'Disk Headroom',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: WINDOW_BACKGROUND[scheme],
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (showOnReady) mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Packaged builds take the Dock icon from the bundle; a development run would
// otherwise show Electron's own icon.
function applyDevDockIcon(): void {
  if (app.isPackaged) return
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
  if (!icon.isEmpty()) {
    app.dock?.setIcon(icon)
  }
}

// The default Electron menu is labelled after Electron; a template built here
// takes its name from app.getName() instead.
function applyAppMenu(): void {
  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    copyright: 'MIT licensed'
  })

  // A packaged build ships without the View menu, so the DevTools shortcut only
  // exists while developing. Reload is moved off Command-R so the renderer can
  // use that chord to start a scan, matching the packaged app (no View menu).
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    { role: 'editMenu' },
    ...(app.isPackaged
      ? []
      : [
          {
            label: 'View',
            submenu: [
              { role: 'reload', accelerator: 'Alt+Command+R' },
              { role: 'forceReload', accelerator: 'Alt+Shift+Command+R' },
              { role: 'toggleDevTools' },
              { type: 'separator' },
              { role: 'resetZoom' },
              { role: 'zoomIn' },
              { role: 'zoomOut' },
              { type: 'separator' },
              { role: 'togglefullscreen' }
            ]
          } satisfies Electron.MenuItemConstructorOptions
        ]),
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow(true)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendToRenderer(channel: string, payload?: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send(channel, payload)
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') {
    app.quit()
    return
  }

  applyDevDockIcon()
  applyAppMenu()
  const settings = await loadSettings()
  currentAppearance = settings.appearance
  applyLaunchAtLogin(settings.launchAtLogin)
  const lowDiskAlert = startLowDiskAlertWatcher({ showWindow })
  const scanReminder = startScanReminderWatcher({ showWindow })
  registerIpc({
    sendToRenderer,
    getTrayController: () => trayController,
    onSettingsChanged: (next) => {
      currentAppearance = next.appearance
      applyNativeAppearance(next.appearance, mainWindow)
      lowDiskAlert.setSettings(next)
      scanReminder.setSettings(next)
    },
    onScanCompleted: (result) => {
      void scanReminder.markScanComplete()
      void recordScanSample(result.items)
    }
  })
  void recordDiskSample()
  startPackagedUpdateCheck()
  // import.meta.env.DEV drops the handlers from the production bundle; the
  // isPackaged guard covers a development bundle someone runs from a copy.
  if (import.meta.env.DEV && !app.isPackaged) {
    registerDebugIpc(lowDiskAlert)
  }
  createWindow(shouldShowWindowOnLaunch())
  applyNativeAppearance(currentAppearance, mainWindow)
  nativeTheme.on('updated', () => {
    applyNativeAppearance(currentAppearance, mainWindow)
  })
  lowDiskAlert.setSettings(settings)
  scanReminder.setSettings(settings)
  trayController = createTray(
    {
      showWindow,
      scanNow: () => {
        showWindow()
        sendToRenderer('tray:scan')
      },
      openDonate: () => {
        showWindow()
        sendToRenderer('tray:donate')
      }
    },
    settings.locale
  )

  app.on('activate', () => {
    showWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

