#!/usr/bin/env node
// Rasterizes the brand SVGs in assets/brand into the binaries the app and
// electron-builder consume. Run with: npm run icons
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brand = join(root, 'assets', 'brand')
const build = join(root, 'build')
const resources = join(root, 'resources')

const APP_ICON = join(brand, 'app-icon-macos.svg')
const TRAY_ICON = join(brand, 'menubar-icon-template.svg')

// iconutil requires this exact set of names to produce a valid .icns.
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

// macOS renders menu bar icons at ~18pt, tinting the template for light/dark.
// The glyph itself sits in a 16pt box so it does not crowd neighbouring items.
const TRAY_SIZES = [
  ['trayTemplate.png', 18, 16],
  ['trayTemplate@2x.png', 36, 32]
]

// Apple's icon grid keeps the artwork at 824 of a 1024 canvas and leaves the
// rest transparent. Filling the canvas edge to edge makes the app look oversized
// next to every other Dock icon.
const APP_ICON_RATIO = 824 / 1024

async function render(source, size) {
  return sharp(source, { density: 384 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function renderAppIcon(size) {
  const artwork = Math.round(size * APP_ICON_RATIO)
  const offset = Math.round((size - artwork) / 2)

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: await render(APP_ICON, artwork), left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

// The source SVG carries generous padding, so trim it and re-centre the glyph
// at a known size instead of inheriting whatever margin the artwork had.
async function renderTemplate(source, canvas, glyph) {
  const trimmed = await sharp(source, { density: 1024 })
    .resize(glyph * 16, glyph * 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .trim({ threshold: 0 })
    .resize(glyph, glyph, { fit: 'inside' })
    .toBuffer()

  const inset = await sharp(trimmed).metadata()
  return sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([
      {
        input: trimmed,
        left: Math.round((canvas - inset.width) / 2),
        top: Math.round((canvas - inset.height) / 2)
      }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

async function writeAppIcon(size, target) {
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, await renderAppIcon(size))
  return target
}

async function main() {
  await writeAppIcon(1024, join(build, 'icon.png'))

  const iconset = join(build, 'icon.iconset')
  await rm(iconset, { recursive: true, force: true })
  await mkdir(iconset, { recursive: true })
  for (const [name, size] of ICONSET) {
    await writeAppIcon(size, join(iconset, name))
  }

  const icns = join(build, 'icon.icns')
  await execFileAsync('iconutil', ['-c', 'icns', iconset, '-o', icns])
  await rm(iconset, { recursive: true, force: true })

  for (const [name, canvas, glyph] of TRAY_SIZES) {
    const target = join(resources, name)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, await renderTemplate(TRAY_ICON, canvas, glyph))
  }

  console.log('Generated build/icon.png, build/icon.icns, and menu bar templates')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
