// Captures README screenshots from the built renderer. Run with: npm run screenshots
const { BrowserWindow, app } = require('electron')
const { mkdir, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const sharp = require('sharp')

const root = join(__dirname, '..', '..')
const outDir = join(root, 'docs', 'screenshots')
const WIDTH = 1000
const HEIGHT = 700
const EXPORT_WIDTH = 1400

// Nav order comes from NAV in src/renderer/src/lib/copy.ts
const NAV = { dashboard: 0, permissions: 1, settings: 2, donate: 3 }

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function openWindow(mode, height = HEIGHT) {
  const win = new BrowserWindow({
    width: WIDTH,
    height,
    show: false,
    // Vibrancy cannot be captured offscreen, so paint the equivalent flat colour.
    backgroundColor: '#1c1c1e',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      additionalArguments: [`--capture-mode=${mode}`]
    }
  })

  await win.loadFile(join(root, 'out', 'renderer', 'index.html'))
  await wait(600)
  return win
}

async function capture(win, name) {
  const image = await win.webContents.capturePage()
  const png = await sharp(image.toPNG())
    .resize({ width: EXPORT_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(join(outDir, `${name}.png`), png)
  console.log(`wrote docs/screenshots/${name}.png`)
}

async function show(win, view) {
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('.nav button')[${NAV[view]}].click()`
  )
  await wait(220)
}

// Windows are closed one at a time between captures, so the default
// "quit when no windows are left" behaviour would end the run early.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  await mkdir(outDir, { recursive: true })

  const firstRun = await openWindow('first-run')
  await capture(firstRun, 'permissions')
  firstRun.destroy()

  const ready = await openWindow('ready')
  await capture(ready, 'scan')

  await show(ready, 'settings')
  await capture(ready, 'settings')

  await show(ready, 'donate')
  await capture(ready, 'donate')

  ready.destroy()

  // The overview runs on a short result so the disk panel, one full category and
  // the floating action bar all fit without the bar covering half a row.
  const results = await openWindow('overview', 900)
  await results.webContents.executeJavaScript(
    "document.querySelector('.main .row button.btn.primary').click()"
  )
  await wait(700)
  await capture(results, 'results')
  results.destroy()

  // The opt-in developer groups sit at the bottom of the list. A shorter window
  // scrolled to the end frames them without cutting through a neighbouring card.
  const developer = await openWindow('ready', 700)
  await developer.webContents.executeJavaScript(
    "document.querySelector('.main .row button.btn.primary').click()"
  )
  await wait(700)
  await developer.webContents.executeJavaScript(
    "const main = document.querySelector('.main'); main.scrollTop = main.scrollHeight"
  )
  await wait(400)
  await capture(developer, 'developer')
  developer.destroy()

  app.quit()
})
