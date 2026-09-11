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
const SCREENSHOT_BACKGROUND = { dark: '#1c1c1e', light: '#f5f5f7' }

// Nav order comes from NAV in src/renderer/src/lib/copy.ts
const NAV = { dashboard: 0, settings: 1 }

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function openWindow(mode, height = HEIGHT, theme = 'dark', pro = false) {
  const extra = [`--capture-mode=${mode}`, `--capture-theme=${theme}`]
  if (pro) extra.push('--capture-pro')
  const win = new BrowserWindow({
    width: WIDTH,
    height,
    show: false,
    // Vibrancy cannot be captured offscreen, so paint the equivalent flat colour.
    backgroundColor: SCREENSHOT_BACKGROUND[theme],
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      sandbox: false,
      contextIsolation: true,
      additionalArguments: extra
    }
  })

  await win.loadFile(join(root, 'out', 'renderer', 'index.html'))
  await wait(600)
  return win
}

async function capture(win, name, destDir = outDir) {
  const image = await win.webContents.capturePage()
  const png = await sharp(image.toPNG())
    .resize({ width: EXPORT_WIDTH, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer()
  await writeFile(join(destDir, `${name}.png`), png)
  console.log(`wrote ${join(destDir, `${name}.png`)}`)
}

async function show(win, view) {
  await win.webContents.executeJavaScript(
    `document.querySelectorAll('.nav button')[${NAV[view]}].click()`
  )
  await wait(220)
}

async function showSettingsTab(win, name) {
  await win.webContents.executeJavaScript(
    `;[...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === ${JSON.stringify(name)})?.click()`
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

  const firstRunLight = await openWindow('first-run', HEIGHT, 'light')
  await capture(firstRunLight, 'permissions-light')
  firstRunLight.destroy()

  const welcome = await openWindow('welcome-preferences')
  await capture(welcome, 'welcome-preferences')
  await welcome.webContents.executeJavaScript(
    `[...document.querySelectorAll('.dialog.welcome button')].find((el) => el.textContent === 'Continue')?.click()`
  )
  await wait(250)
  await capture(welcome, 'welcome-preferences-howto')
  await welcome.webContents.executeJavaScript(
    `[...document.querySelectorAll('.dialog.welcome button')].find((el) => el.textContent === 'Got it')?.click()`
  )
  await wait(250)
  await capture(welcome, 'product-tour')
  for (let i = 0; i < 5; i += 1) {
    await welcome.webContents.executeJavaScript(
      `[...document.querySelectorAll('.tour-tooltip button')].find((el) => el.textContent === 'Next')?.click()`
    )
    await wait(280)
  }
  await capture(welcome, 'product-tour-settings')
  welcome.destroy()

  const welcomeLight = await openWindow('welcome-preferences', HEIGHT, 'light')
  await capture(welcomeLight, 'welcome-preferences-light')
  welcomeLight.destroy()

  const resultsTour = await openWindow('results-tour', 900)
  await resultsTour.webContents.executeJavaScript(
    "document.querySelector('.main .row button.btn.primary')?.click()"
  )
  await wait(700)
  await capture(resultsTour, 'product-tour-results')
  resultsTour.destroy()

  const ready = await openWindow('ready')
  await capture(ready, 'scan')

  await show(ready, 'settings')
  await showSettingsTab(ready, 'Scan')
  ready.setSize(WIDTH, 1800)
  await wait(200)
  await capture(ready, 'settings')
  ready.destroy()

  const forecast = await openWindow('ready', 860, 'dark', true)
  await capture(forecast, 'scan-forecast')
  forecast.destroy()

  const shortcuts = await openWindow('ready')
  await show(shortcuts, 'settings')
  await showSettingsTab(shortcuts, 'General')
  shortcuts.setSize(WIDTH, 1400)
  await wait(200)
  await shortcuts.webContents.executeJavaScript(`
    const heading = [...document.querySelectorAll('h3')].find((el) => el.textContent === 'Keyboard shortcuts')
    const main = document.querySelector('.main')
    if (heading && main) {
      const offset = heading.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 16
      main.scrollTop = offset
    }
  `)
  shortcuts.setSize(WIDTH, 920)
  await wait(250)
  await capture(shortcuts, 'settings-shortcuts')
  shortcuts.destroy()

  const updates = await openWindow('ready')
  await show(updates, 'settings')
  await showSettingsTab(updates, 'Updates')
  updates.setSize(WIDTH, 900)
  await wait(200)
  await capture(updates, 'settings-updates')
  updates.destroy()

  const pro = await openWindow('ready')
  await show(pro, 'settings')
  await showSettingsTab(pro, 'Pro')
  pro.setSize(WIDTH, 900)
  await wait(200)
  await capture(pro, 'pro')
  pro.destroy()

  const proLight = await openWindow('ready', 900, 'light')
  await show(proLight, 'settings')
  await showSettingsTab(proLight, 'Pro')
  await wait(200)
  await capture(proLight, 'pro-light')
  proLight.destroy()

  const light = await openWindow('ready', HEIGHT, 'light')
  await capture(light, 'scan-light')
  await show(light, 'settings')
  await showSettingsTab(light, 'Scan')
  light.setSize(WIDTH, 1800)
  await wait(200)
  await capture(light, 'settings-light')
  light.destroy()

  // The overview runs on a short result so the disk panel, one full category and
  // the floating action bar all fit without the bar covering half a row.
  const results = await openWindow('overview', 900)
  await results.webContents.executeJavaScript(
    "document.querySelector('.main .row button.btn.primary').click()"
  )
  await wait(700)
  await capture(results, 'results')
  results.destroy()

  const resultsLight = await openWindow('overview', 900, 'light')
  await resultsLight.webContents.executeJavaScript(
    "document.querySelector('.main .row button.btn.primary').click()"
  )
  await wait(700)
  await capture(resultsLight, 'results-light')
  resultsLight.destroy()

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

  const developerLight = await openWindow('ready', 700, 'light')
  await developerLight.webContents.executeJavaScript(
    "document.querySelector('.main .row button.btn.primary').click()"
  )
  await wait(700)
  await developerLight.webContents.executeJavaScript(
    "const main = document.querySelector('.main'); main.scrollTop = main.scrollHeight"
  )
  await wait(400)
  await capture(developerLight, 'developer-light')
  developerLight.destroy()

  app.quit()
})
