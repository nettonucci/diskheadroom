import { BrowserWindow, Menu, nativeImage, shell, app } from 'electron'
import { join } from 'node:path'
import { APP_NAME } from '../shared/constants'
import { registerIpc } from './ipc'
import { registerDebugIpc } from './debug'
import { startLowDiskAlertWatcher } from './lowDiskAlert'
import { loadSettings } from './settings'
import { createTray, type TrayController } from './tray'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let trayController: TrayController | null = null

// A development run inherits Electron's bundle name, which then shows up in the
// menu bar, the About panel and the user-data folder. Must run before ready.
app.setName(APP_NAME)

function createWindow(): void {
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
    backgroundColor: '#1c1c1ecc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
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

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
  )
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendToRenderer(channel: string, payload?: unknown): void {
  mainWindow?.webContents.send(channel, payload)
}

app.whenReady().then(async () => {
  if (process.platform !== 'darwin') {
    app.quit()
    return
  }

  applyDevDockIcon()
  applyAppMenu()
  const lowDiskAlert = startLowDiskAlertWatcher({ showWindow })
  registerIpc({
    sendToRenderer,
    getTrayController: () => trayController,
    onSettingsChanged: (next) => lowDiskAlert.setSettings(next)
  })
  // import.meta.env.DEV drops the handlers from the production bundle; the
  // isPackaged guard covers a development bundle someone runs from a copy.
  if (import.meta.env.DEV && !app.isPackaged) {
    registerDebugIpc(lowDiskAlert)
  }
  createWindow()
  const settings = await loadSettings()
  lowDiskAlert.setSettings(settings)
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

