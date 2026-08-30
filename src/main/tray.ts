import { Menu, Tray, app, nativeImage } from 'electron'
import { join } from 'node:path'
import { translate, type Locale } from '../shared/i18n'

interface TrayOptions {
  showWindow: () => void
  scanNow: () => void
  openDonate: () => void
}

export interface TrayController {
  tray: Tray
  setLocale: (locale: Locale) => void
}

export function createTray(opts: TrayOptions, initialLocale: Locale): TrayController {
  const image = nativeImage.createFromPath(trayIconPath())
  if (!image.isEmpty()) {
    image.setTemplateImage(true)
  }

  const tray = new Tray(image)
  tray.setToolTip('Disk Headroom')
  const setLocale = (locale: Locale): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
      { label: translate(locale, 'tray.open'), click: opts.showWindow },
      { label: translate(locale, 'tray.scan'), click: opts.scanNow },
      { type: 'separator' },
      { label: translate(locale, 'tray.donate'), click: opts.openDonate },
      { type: 'separator' },
      { label: translate(locale, 'tray.quit'), click: () => app.quit() }
    ])
    )
  }
  setLocale(initialLocale)
  tray.on('click', opts.showWindow)
  return { tray, setLocale }
}

function trayIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'trayTemplate.png')
  }
  return join(app.getAppPath(), 'resources', 'trayTemplate.png')
}
