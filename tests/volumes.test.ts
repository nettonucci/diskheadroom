import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  lstat: vi.fn(),
  readlink: vi.fn(),
  stat: vi.fn(),
  showOpenDialog: vi.fn()
}))

vi.mock('node:fs/promises', () => {
  const module = {
    readdir: mocks.readdir,
    lstat: mocks.lstat,
    readlink: mocks.readlink,
    stat: mocks.stat
  }
  return { default: module, ...module }
})

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: mocks.showOpenDialog
  },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null)
  }
}))

vi.mock('node:os', () => ({
  default: { homedir: () => '/Users/test' },
  homedir: () => '/Users/test'
}))

import { isSafePath, scanExternalVolumes } from '../src/main/scanner'
import { listMountedVolumes, pickExternalVolumeDialog } from '../src/main/volumes'

const directory = {
  isSymbolicLink: () => false,
  isFile: () => false,
  isDirectory: () => true,
  size: 0
}

const file = (size: number) => ({
  isSymbolicLink: () => false,
  isFile: () => true,
  isDirectory: () => false,
  size
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.stat.mockResolvedValue({ mtimeMs: Date.now() - 200 * 86400000 })
})

describe('volumes helper', () => {
  it('lists mounted volumes and excludes system volumes', async () => {
    mocks.readdir.mockResolvedValueOnce([
      'Macintosh HD',
      'Backup Disk',
      '.hidden',
      'Flash Drive'
    ])
    mocks.readlink.mockImplementation(async (targetPath: string) => {
      if (targetPath.includes('Macintosh HD')) return '/'
      return ''
    })
    mocks.lstat.mockImplementation(async (targetPath: string) => {
      if (targetPath.includes('.hidden')) return file(10)
      if (targetPath.includes('Macintosh HD')) {
        return {
          isSymbolicLink: () => true,
          isFile: () => false,
          isDirectory: () => false,
          size: 0
        }
      }
      return directory
    })

    const volumes = await listMountedVolumes()
    expect(volumes).toEqual([
      { name: 'Backup Disk', path: '/Volumes/Backup Disk' },
      { name: 'Flash Drive', path: '/Volumes/Flash Drive' }
    ])
  })

  it('returns empty list when readdir fails', async () => {
    mocks.readdir.mockRejectedValueOnce(new Error('EPERM'))
    const volumes = await listMountedVolumes()
    expect(volumes).toEqual([])
  })

  it('handles volume picker dialog when path selected', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: ['/Volumes/ExternalDrive']
    })

    const selected = await pickExternalVolumeDialog()
    expect(selected).toBe('/Volumes/ExternalDrive')
    expect(mocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory', 'dontAddToRecent'],
      defaultPath: '/Volumes',
      title: 'Select External Volume'
    })
  })

  it('handles volume picker dialog when canceled', async () => {
    mocks.showOpenDialog.mockResolvedValueOnce({
      canceled: true,
      filePaths: []
    })

    const selected = await pickExternalVolumeDialog()
    expect(selected).toBeNull()
  })
})

describe('external volume path safety', () => {
  const volumeRoots = ['/Volumes/ExternalDrive', '/Volumes/USB']

  it('rejects volume roots themselves', () => {
    expect(isSafePath('/Volumes', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/ExternalDrive', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/USB', volumeRoots)).toBe(false)
  })

  it('rejects blocked system and hidden prefixes on external volumes', () => {
    expect(isSafePath('/Volumes/ExternalDrive/.Trashes', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/ExternalDrive/.Trashes/501', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/ExternalDrive/.Spotlight-V100', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/ExternalDrive/.fseventsd', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/ExternalDrive/.DocumentRevisions-V100', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/ExternalDrive/.TemporaryItems', volumeRoots)).toBe(false)
    expect(isSafePath('/Volumes/ExternalDrive/.VolumeIcon.icns', volumeRoots)).toBe(false)
  })

  it('allows safe subdirectories and files on external volumes', () => {
    expect(isSafePath('/Volumes/ExternalDrive/OldBackups', volumeRoots)).toBe(true)
    expect(isSafePath('/Volumes/ExternalDrive/Projects/cache.tar', volumeRoots)).toBe(true)
    expect(isSafePath('/Volumes/USB/Videos/large_clip.mov', volumeRoots)).toBe(true)
  })

  it('rejects system paths even if volume roots are provided', () => {
    expect(isSafePath('/', volumeRoots)).toBe(false)
    expect(isSafePath('/System', volumeRoots)).toBe(false)
    expect(isSafePath('/System/Library', volumeRoots)).toBe(false)
    expect(isSafePath('/usr/sbin/tool', volumeRoots)).toBe(false)
    expect(isSafePath('/bin/sh', volumeRoots)).toBe(false)
    expect(isSafePath('/sbin/launchd', volumeRoots)).toBe(false)
    expect(isSafePath('/private/var/db', volumeRoots)).toBe(false)
  })
})

describe('scanExternalVolumes', () => {
  it('returns empty array when isPro is false', async () => {
    const items = await scanExternalVolumes(['/Volumes/ExternalDrive'], false)
    expect(items).toEqual([])
    expect(mocks.readdir).not.toHaveBeenCalled()
  })

  it('skips missing or unmounted volumes', async () => {
    mocks.readdir.mockRejectedValueOnce(new Error('ENOENT'))
    const items = await scanExternalVolumes(['/Volumes/MissingVolume'], true)
    expect(items).toEqual([])
  })

  it('scans items on configured external volume and marks them unchecked by default', async () => {
    const vol = '/Volumes/ExternalDrive'
    const oldMs = Date.now() - 120 * 86400000

    mocks.readdir.mockImplementation(async (targetPath: string) => {
      if (targetPath === vol) {
        return ['.Trashes', '.Spotlight-V100', 'OldArchive', 'ProjectFiles', 'temp.iso']
      }
      if (targetPath === `${vol}/OldArchive`) {
        return ['subfile.bin']
      }
      if (targetPath === `${vol}/ProjectFiles`) {
        return ['data.dat']
      }
      return []
    })

    mocks.lstat.mockImplementation(async (targetPath: string) => {
      if (targetPath === `${vol}/OldArchive`) return { ...directory, mtimeMs: oldMs }
      if (targetPath === `${vol}/ProjectFiles`) return { ...directory, mtimeMs: oldMs }
      if (targetPath === `${vol}/temp.iso`) return { ...file(50000), mtimeMs: oldMs }
      if (targetPath.endsWith('subfile.bin')) return { ...file(20000), mtimeMs: oldMs }
      if (targetPath.endsWith('data.dat')) return { ...file(30000), mtimeMs: oldMs }
      return directory
    })

    mocks.stat.mockImplementation(async (targetPath: string) => {
      return { mtimeMs: oldMs }
    })

    const items = await scanExternalVolumes([vol], true, 90)
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((item) => item.categoryId === 'externalVolumes')).toBe(true)
    expect(items.every((item) => item.selectedByDefault === false)).toBe(true)
    expect(items.every((item) => item.optional === true)).toBe(true)
    expect(items.some((item) => item.path === `${vol}/.Trashes`)).toBe(false)
    expect(items.some((item) => item.path === `${vol}/.Spotlight-V100`)).toBe(false)
    expect(items.some((item) => item.path === `${vol}/OldArchive`)).toBe(true)
    expect(items.some((item) => item.path === `${vol}/temp.iso`)).toBe(true)
  })
})
