// Renders the low disk alert banner for release-notes posts.
// Run with: npm run screenshots:notification -- --locale=pt-BR --percent=5
//
// macOS posts notifications from the app bundle and gives no way to capture a
// banner from a script, so this reproduces the system banner instead. The icon
// is the real build/icon.png and the copy is read from src/shared/languages.json,
// so the image cannot drift from what the app actually sends.
const { BrowserWindow, app } = require('electron')
const { mkdir, readFile, writeFile } = require('node:fs/promises')
const { join } = require('node:path')

const root = join(__dirname, '..', '..')
const outDir = join(root, 'docs', 'screenshots')

const arg = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`))
  return match ? match.split('=')[1] : fallback
}

const locale = arg('locale', 'pt-BR')
const percent = Number(arg('percent', '5'))
const outName = arg('out', `notification-${locale}`)

const escape = (value) =>
  value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char])

function translate(catalog, key, values) {
  const template = catalog[locale]?.[key] ?? catalog.en[key]
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name])
  )
}

// Point metrics of a macOS banner. capturePage doubles this again on a Retina
// display, so the export lands at roughly 1376px wide.
const SCALE = 2
const pt = (value) => `${value * SCALE}px`
const BANNER_WIDTH = 344 * SCALE
const MARGIN = 30 * SCALE

function html(icon, title, body) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  html, body {
    margin: 0;
    background: transparent;
    -webkit-font-smoothing: antialiased;
  }
  body {
    padding: ${MARGIN}px;
    width: max-content;
  }
  .banner {
    width: ${BANNER_WIDTH}px;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: ${pt(38)} 1fr;
    gap: ${pt(12)};
    align-items: center;
    padding: ${pt(12)} ${pt(14)};
    border-radius: ${pt(15)};
    background: #232326;
    box-shadow: 0 ${pt(8)} ${pt(24)} rgba(0, 0, 0, 0.45);
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  }
  .banner img {
    width: ${pt(38)};
    height: ${pt(38)};
    display: block;
  }
  .title {
    font-size: ${pt(13)};
    font-weight: 700;
    letter-spacing: -0.1px;
    color: #ffffff;
    margin-bottom: ${pt(1)};
  }
  .body {
    font-size: ${pt(13)};
    line-height: 1.3;
    letter-spacing: -0.1px;
    color: rgba(255, 255, 255, 0.94);
  }
</style>
<div class="banner">
  <img src="${icon}" alt="">
  <div>
    <div class="title">${escape(title)}</div>
    <div class="body">${escape(body)}</div>
  </div>
</div>`
}

app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  const catalog = JSON.parse(await readFile(join(root, 'src', 'shared', 'languages.json'), 'utf8'))
  const iconData = await readFile(join(root, 'build', 'icon.png'))
  const icon = `data:image/png;base64,${iconData.toString('base64')}`
  const title = translate(catalog, 'alert.lowDisk.title', {})
  const body = translate(catalog, 'alert.lowDisk.body', { percent })

  const win = new BrowserWindow({
    width: BANNER_WIDTH + MARGIN * 2,
    height: 400,
    show: false,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000'
  })

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html(icon, title, body))}`)
  await new Promise((resolve) => setTimeout(resolve, 400))

  const size = await win.webContents.executeJavaScript(
    'JSON.stringify({ width: document.body.scrollWidth, height: document.body.scrollHeight })'
  )
  const { width, height } = JSON.parse(size)
  win.setContentSize(width, height)
  await new Promise((resolve) => setTimeout(resolve, 200))

  const image = await win.webContents.capturePage()
  await mkdir(outDir, { recursive: true })
  await writeFile(join(outDir, `${outName}.png`), image.toPNG())
  console.log(`wrote docs/screenshots/${outName}.png (${title})`)

  win.destroy()
  app.quit()
})
