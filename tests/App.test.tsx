import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { DEFAULT_SCAN_CATEGORIES } from '../src/shared/constants'

const disk = {
  mount: '/',
  totalBytes: 1000,
  usedBytes: 600,
  freeBytes: 400
}
const granted = {
  fullDiskAccess: true,
  libraryCachesReadable: true,
  applicationsReadable: true
}
const settings = {
  unusedDays: 90 as const,
  setupComplete: true,
  locale: 'en' as const,
  scanCategories: { ...DEFAULT_SCAN_CATEGORIES },
  largeFileMinBytes: 500 * 1024 * 1024 as const,
  lowDiskAlert: { enabled: false, kind: 'percent' as const, value: 10 },
  launchAtLogin: false,
  scanReminder: { enabled: false, intervalDays: 7 as const },
  neverTouchPaths: []
}
const result = {
  scannedAt: '2025-01-01T00:00:00Z',
  limited: false,
  items: [
    {
      id: 'a',
      categoryId: 'userCaches' as const,
      name: 'Cache A',
      path: '/Users/test/Library/Caches/a',
      bytes: 2048,
      selectedByDefault: true,
      optional: false,
      lastUsedAt: null,
      daysIdle: null
    },
    {
      id: 'b',
      categoryId: 'unusedApps' as const,
      name: 'Old App',
      path: '/Applications/Old App.app',
      bytes: 4096,
      selectedByDefault: false,
      optional: true,
      lastUsedAt: '2024-01-01T00:00:00Z',
      daysIdle: 365
    }
  ]
}

const debugStatus = {
  disk: { mount: '/', totalBytes: 1000, freeBytes: 400, usedBytes: 600 },
  realFreeBytes: 400,
  simulatedFreePercent: null,
  alert: { enabled: true, kind: 'percent' as const, value: 10 },
  belowThreshold: false,
  lastFiredAt: null,
  cooldownMs: 12 * 60 * 60 * 1000,
  notificationsSupported: true
}

type Api = Window['diskheadroom']

function api(overrides: Partial<Api> = {}): Api {
  return {
    getDiskInfo: vi.fn().mockResolvedValue(disk),
    getPermissions: vi.fn().mockResolvedValue(granted),
    openFullDiskAccess: vi.fn().mockResolvedValue(undefined),
    getGrantTarget: vi.fn().mockResolvedValue({
      displayName: 'Disk Headroom',
      bundlePath: '/Applications/Disk Headroom.app',
      packaged: true,
      launchedBy: null
    }),
    revealGrantTarget: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(settings),
    setSettings: vi.fn().mockImplementation(async (next) => next),
    runScan: vi.fn().mockResolvedValue(result),
    trashItems: vi.fn().mockResolvedValue({
      trashed: ['/Users/test/Library/Caches/a'],
      failed: [],
      bytesRequested: 2048
    }),
    pickFolder: vi.fn().mockResolvedValue(null),
    getLicenseStatus: vi.fn().mockResolvedValue({ isPro: false }),
    activateLicense: vi.fn().mockResolvedValue({ isPro: false }),
    openExternal: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined),
    revealItem: vi.fn().mockResolvedValue(true),
    debug: {
      lowDiskStatus: vi.fn().mockResolvedValue(debugStatus),
      simulateFreePercent: vi.fn().mockResolvedValue({ ...debugStatus, simulatedFreePercent: 5 }),
      runLowDiskCheck: vi.fn().mockResolvedValue(debugStatus),
      resetLowDiskCooldown: vi.fn().mockResolvedValue(debugStatus),
      sendLowDiskNotification: vi.fn().mockResolvedValue({ shown: true, status: debugStatus })
    },
    onScanProgress: vi.fn(() => () => {}),
    onTrayScan: vi.fn(() => () => {}),
    onTrayDonate: vi.fn(() => () => {}),
    ...overrides
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
  window.diskheadroom = api()
})

describe('App', () => {
  it('shows a bridge fallback outside Electron', () => {
    const bridge = window.diskheadroom
    // @ts-expect-error exercising the explicit runtime fallback
    delete window.diskheadroom
    render(<App />)
    expect(screen.getByText('Disk Headroom')).toBeInTheDocument()
    expect(screen.getByText(/no native bridge/)).toBeInTheDocument()
    window.diskheadroom = bridge
  })

  it('handles first-run permissions and developer assistance', async () => {
    const bridge = api({
      getSettings: vi.fn().mockResolvedValue({ ...settings, setupComplete: false }),
      getPermissions: vi.fn().mockResolvedValue({
        ...granted,
        fullDiskAccess: false,
        applicationsReadable: false
      }),
      getGrantTarget: vi.fn().mockResolvedValue({
        displayName: 'Electron',
        bundlePath: '/project/node_modules/electron/dist/Electron.app',
        packaged: false,
        launchedBy: 'Cursor'
      })
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('System access')).toBeInTheDocument()
    expect(screen.getAllByText('Missing')).toHaveLength(2)
    expect(screen.getByText(/Cursor/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copy path' }))
    expect(bridge.copyText).toHaveBeenCalled()
    expect(await screen.findByText('Path copied')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reveal in Finder' }))
    expect(bridge.revealGrantTarget).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Open System Settings' }))
    expect(bridge.openFullDiskAccess).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Continue with limited scan' }))
    expect(bridge.setSettings).toHaveBeenCalledWith(expect.objectContaining({ setupComplete: true }))
    expect(await screen.findByText('Reclaim storage')).toBeInTheDocument()
  })

  it('scans, selects groups, rescans and cleans selected items', async () => {
    const progressListeners: Array<(value: { phase: 'progress.starting'; percent: number }) => void> = []
    const bridge = api({
      onScanProgress: vi.fn((callback) => {
        progressListeners.push(callback)
        return () => {}
      })
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Reclaim storage')).toBeInTheDocument()
    act(() => progressListeners[0]?.({ phase: 'progress.starting', percent: 25 }))
    await user.click(screen.getByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByText('Review before cleaning')).toBeInTheDocument()
    expect(screen.getByText(/^Scanned /)).toBeInTheDocument()
    expect(screen.getByText('Cache A')).toBeInTheDocument()
    expect(screen.getByText('Old App')).toBeInTheDocument()
    expect(screen.getByText(/Last used/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select group' }))
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Clear group' })[1])
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(bridge.trashItems).toHaveBeenCalled())
    expect(await screen.findByText(/Moved 1 item/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    await waitFor(() => expect(bridge.runScan).toHaveBeenCalledTimes(2))
  })

  it('reveals a result in Finder and copies its path with feedback', async () => {
    const bridge = api()
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    expect(await screen.findByText('Cache A')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Reveal in Finder' })[0])
    expect(bridge.revealItem).toHaveBeenCalledWith('/Users/test/Library/Caches/a')

    await user.click(screen.getAllByRole('button', { name: 'Copy path' })[1])
    expect(bridge.copyText).toHaveBeenCalledWith('/Applications/Old App.app')
    expect(await screen.findByText('Path copied')).toBeInTheDocument()
  })

  it('filters results by name or path and only selects visible group items', async () => {
    const mixed = {
      ...result,
      items: [
        result.items[0],
        {
          ...result.items[0],
          id: 'c',
          name: 'Cache C',
          path: '/Users/test/Library/Caches/unique-token',
          bytes: 1024,
          selectedByDefault: true
        },
        result.items[1]
      ]
    }
    window.diskheadroom = api({ runScan: vi.fn().mockResolvedValue(mixed) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    expect(await screen.findByText('Cache A')).toBeInTheDocument()

    const filter = screen.getByRole('searchbox', { name: 'Filter by name or path' })
    await user.type(filter, 'old app')
    expect(screen.queryByText('Cache A')).not.toBeInTheDocument()
    expect(screen.getByText('Old App')).toBeInTheDocument()

    await user.clear(filter)
    expect(screen.getByText('Cache A')).toBeInTheDocument()
    expect(screen.getByText('Cache C')).toBeInTheDocument()

    await user.type(filter, 'UNIQUE-TOKEN')
    expect(screen.queryByText('Cache A')).not.toBeInTheDocument()
    expect(screen.getByText('Cache C')).toBeInTheDocument()
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear group' }))
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()

    await user.clear(filter)
    expect(screen.getByText('Cache A')).toBeInTheDocument()
    expect(screen.getByText('Cache C')).toBeInTheDocument()
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()

    await user.type(filter, 'zzz-missing')
    expect(screen.getByText('Nothing matches that filter')).toBeInTheDocument()
    expect(screen.queryByText('Cache A')).not.toBeInTheDocument()
    expect(screen.queryByText('Old App')).not.toBeInTheDocument()
  })

  it('shows Docker Desktop leftovers unchecked with a warning before trash', async () => {
    const dockerResult = {
      ...result,
      items: [
        {
          id: 'docker',
          categoryId: 'dockerDesktop' as const,
          name: '',
          nameKey: 'category.dockerDesktop.diskImage' as const,
          path: '/Users/test/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw',
          bytes: 8192,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: null,
          daysIdle: null
        }
      ]
    }
    const bridge = api({
      runScan: vi.fn().mockResolvedValue(dockerResult),
      trashItems: vi.fn().mockResolvedValue({
        trashed: [dockerResult.items[0].path],
        failed: [],
        bytesRequested: 8192
      })
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByText('Docker Desktop disk image')).toBeInTheDocument()
    expect(screen.getByText(/High impact/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/Docker Desktop/)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(bridge.trashItems).toHaveBeenCalled())
  })

  it('shows large home files unchecked with a warning before trash', async () => {
    const largeFilesResult = {
      ...result,
      items: [
        {
          id: 'large-file',
          categoryId: 'largeFiles' as const,
          name: 'large_archive.iso',
          path: '/Users/test/Downloads/large_archive.iso',
          bytes: 1024 * 1024 * 1024,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: null,
          daysIdle: null
        }
      ]
    }
    const bridge = api({
      runScan: vi.fn().mockResolvedValue(largeFilesResult),
      trashItems: vi.fn().mockResolvedValue({
        trashed: [largeFilesResult.items[0].path],
        failed: [],
        bytesRequested: 1024 * 1024 * 1024
      })
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByText('large_archive.iso')).toBeInTheDocument()
    expect(screen.getByText(/individual files in your home folder/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/Move 1 item \(1.0 GB\) to Trash/)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(bridge.trashItems).toHaveBeenCalled())
  })

  it('shows extra Xcode leftovers unchecked by default', async () => {
    const xcodeResult = {
      ...result,
      items: [
        {
          id: 'archives',
          categoryId: 'xcodeArchives' as const,
          name: '',
          nameKey: 'category.xcodeArchives.title' as const,
          path: '/Users/test/Library/Developer/Xcode/Archives',
          bytes: 4096,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: null,
          daysIdle: null
        },
        {
          id: 'sim',
          categoryId: 'unavailableSimulators' as const,
          name: 'iPhone 14',
          path: '/Users/test/Library/Developer/CoreSimulator/Devices/11111111-2222-3333-4444-555555555555',
          bytes: 2048,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: null,
          daysIdle: null
        },
        {
          id: 'caches',
          categoryId: 'coreSimulatorCaches' as const,
          name: '',
          nameKey: 'category.coreSimulatorCaches.title' as const,
          path: '/Users/test/Library/Developer/CoreSimulator/Caches',
          bytes: 1024,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: null,
          daysIdle: null
        }
      ]
    }
    window.diskheadroom = api({ runScan: vi.fn().mockResolvedValue(xcodeResult) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByRole('heading', { name: 'Xcode Archives' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unavailable simulators' })).toBeInTheDocument()
    expect(screen.getByText('iPhone 14')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'CoreSimulator caches' })).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()
  })

  it('shows Android, Gradle and CocoaPods leftovers unchecked by default', async () => {
    const androidResult = {
      ...result,
      items: [
        {
          id: 'gradle',
          categoryId: 'androidDevCaches' as const,
          name: '',
          nameKey: 'category.androidDevCaches.gradle' as const,
          path: '/Users/test/.gradle/caches',
          bytes: 4096,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: null,
          daysIdle: null
        },
        {
          id: 'pods',
          categoryId: 'androidDevCaches' as const,
          name: '',
          nameKey: 'category.androidDevCaches.cocoapods' as const,
          path: '/Users/test/Library/Caches/CocoaPods',
          bytes: 2048,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: null,
          daysIdle: null
        }
      ]
    }
    window.diskheadroom = api({ runScan: vi.fn().mockResolvedValue(androidResult) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByRole('heading', { name: 'Android, Gradle & CocoaPods' })).toBeInTheDocument()
    expect(screen.getByText('Gradle caches')).toBeInTheDocument()
    expect(screen.getByText('CocoaPods cache')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()
  })

  it('shows old Documents and Desktop items unchecked with a warning', async () => {
    const documentsResult = {
      ...result,
      items: [
        {
          id: 'archive',
          categoryId: 'idleUserFolders' as const,
          name: 'Archive 2022',
          path: '/Users/test/Documents/Archive 2022',
          bytes: 250 * 1024 * 1024,
          selectedByDefault: false,
          optional: true,
          lastUsedAt: '2022-04-01T00:00:00.000Z',
          daysIdle: 1400
        }
      ]
    }
    window.diskheadroom = api({ runScan: vi.fn().mockResolvedValue(documentsResult) })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByRole('heading', { name: 'Documents & Desktop' })).toBeInTheDocument()
    expect(screen.getByText('Archive 2022')).toBeInTheDocument()
    expect(screen.getByText(/These are your files, not caches/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()
  })

  it('keeps the disk panel on results and rereads free space when refocused', async () => {
    const bridge = api({
      getDiskInfo: vi
        .fn()
        .mockResolvedValueOnce(disk)
        .mockResolvedValue({ ...disk, usedBytes: 300, freeBytes: 700 })
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('400 B free of 1000 B')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByText('Review before cleaning')).toBeInTheDocument()
    expect(screen.getByText('Startup disk')).toBeInTheDocument()
    expect(screen.getByText('Found in this scan')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select group' }))
    expect(screen.getByText('Selected to remove')).toBeInTheDocument()
    expect(screen.getByText(/free after cleanup/)).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText('700 B free of 1000 B')).toBeInTheDocument()

    // A hidden window should not keep polling df in the background.
    const callsWhileVisible = bridge.getDiskInfo.mock.calls.length
    Object.defineProperty(document, 'hidden', { value: true, configurable: true })
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(bridge.getDiskInfo).toHaveBeenCalledTimes(callsWhileVisible)
    Object.defineProperty(document, 'hidden', { value: false, configurable: true })

    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(screen.getByRole('dialog')).toHaveTextContent(/Move 2 items/)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(bridge.trashItems).toHaveBeenCalled())
  })

  it('stays usable when the capacity reading fails', async () => {
    const bridge = api({ getDiskInfo: vi.fn().mockRejectedValue(new Error('df unavailable')) })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Reclaim storage')).toBeInTheDocument()
    expect(screen.queryByText('Startup disk')).not.toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await user.click(screen.getByRole('button', { name: 'Scan this Mac' }))
    expect(await screen.findByText('Review before cleaning')).toBeInTheDocument()
    expect(screen.queryByText('Startup disk')).not.toBeInTheDocument()
  })

  it('does not clean when confirmation is cancelled', async () => {
    const bridge = api()
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    await user.click(await screen.findByRole('button', { name: 'Move to Trash' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bridge.trashItems).not.toHaveBeenCalled()
  })

  it('does not clean when confirmation is dismissed with Escape', async () => {
    const bridge = api()
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    await user.click(await screen.findByRole('button', { name: 'Move to Trash' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bridge.trashItems).not.toHaveBeenCalled()
  })

  it('renders limited and empty scan states', async () => {
    const bridge = api({
      getPermissions: vi.fn().mockResolvedValue({ ...granted, fullDiskAccess: false }),
      runScan: vi.fn().mockResolvedValue({ ...result, limited: true, items: [] })
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText(/Full Disk Access is off/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Scan this Mac' }))
    expect(await screen.findByText('Nothing obvious turned up')).toBeInTheDocument()
    expect(screen.getByText(/without Full Disk Access/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()
  })

  it('reports partial cleanup failures and generic translated item names', async () => {
    const mixedResult = {
      ...result,
      items: [
        { ...result.items[0], id: 'a', name: '', nameKey: 'category.trash.title' as const },
        {
          ...result.items[1],
          id: 'b',
          selectedByDefault: true,
          lastUsedAt: null,
          daysIdle: null
        },
        { ...result.items[0], id: 'c', name: 'Cache C', path: '/Users/test/Library/Caches/c' },
        { ...result.items[0], id: 'd', name: 'Cache D', path: '/Users/test/Library/Caches/d' },
        {
          ...result.items[0],
          id: 'e',
          categoryId: 'dockerDesktop' as const,
          name: '',
          nameKey: 'category.dockerDesktop.buildx' as const,
          path: '/Users/test/.docker/buildx'
        }
      ]
    }
    const bridge = api({
      runScan: vi.fn().mockResolvedValue(mixedResult),
      trashItems: vi.fn().mockResolvedValue({
        trashed: ['/Users/test/Library/Caches/a', '/Users/test/Library/Caches/c'],
        failed: [
          { path: '/Applications/Old App.app', error: 'locked' },
          { path: '/Users/test/Library/Caches/d', error: 'locked' }
        ],
        bytesRequested: 10240
      })
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    expect(await screen.findByText('Trash')).toBeInTheDocument()
    expect(screen.getByText(/Never recorded/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    // A batch mixing Docker with ordinary caches must still warn about Docker.
    expect(screen.getByRole('dialog')).toHaveTextContent(/Docker Desktop data/)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByText(/2 items could not be moved/)).toBeInTheDocument()
    expect(screen.getByText('These items stayed in place:')).toBeInTheDocument()
    const failed = screen.getByRole('list')
    expect(within(failed).getByText('/Applications/Old App.app')).toBeInTheDocument()
    expect(within(failed).getByText('/Users/test/Library/Caches/d')).toBeInTheDocument()
    expect(screen.getByText(/Trash is emptied/)).toBeInTheDocument()
  })

  it('shows a recoverable error when the scan throws', async () => {
    const bridge = api({
      runScan: vi.fn().mockRejectedValue(new Error('scan crashed'))
    })
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The scan did not finish')
    expect(screen.queryByText('Review before cleaning')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scan this Mac' })).toBeEnabled()
  })

  it('shows large files as Pro-only and enables its controls for Pro', async () => {
    const freeBridge = api()
    window.diskheadroom = freeBridge
    const user = userEvent.setup()
    const { unmount } = render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('checkbox', { name: /Large files/ })).toBeDisabled()
    expect(screen.getByDisplayValue('500 MB')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Get Pro to enable' }))
    expect(freeBridge.openExternal).toHaveBeenCalledWith('https://www.diskheadroom.com/en/pro')

    unmount()
    const proBridge = api({ getLicenseStatus: vi.fn().mockResolvedValue({ isPro: true }) })
    window.diskheadroom = proBridge
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('checkbox', { name: /Large files/ })).toBeEnabled()
    fireEvent.change(screen.getByDisplayValue('500 MB'), {
      target: { value: String(1024 * 1024 * 1024) }
    })
    await waitFor(() =>
      expect(proBridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ largeFileMinBytes: 1024 * 1024 * 1024 })
      )
    )
  })

  it('updates settings, opens permissions, and opens external links', async () => {
    const bridge = api()
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Reclaim storage')

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.change(screen.getByDisplayValue('90 days'), { target: { value: '180' } })
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(expect.objectContaining({ unusedDays: 180 }))
    )
    await user.click(screen.getByRole('checkbox', { name: 'Start Disk Headroom at login' }))
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(expect.objectContaining({ launchAtLogin: true }))
    )
    await user.click(screen.getByRole('checkbox', { name: 'Remind me to scan' }))
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          scanReminder: expect.objectContaining({ enabled: true, intervalDays: 7 })
        })
      )
    )
    fireEvent.change(screen.getByLabelText('Remind me every'), { target: { value: '14' } })
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          scanReminder: expect.objectContaining({ intervalDays: 14 })
        })
      )
    )
    await user.click(screen.getByRole('checkbox', { name: 'Notify me when free space is low' }))
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          lowDiskAlert: expect.objectContaining({ enabled: true, kind: 'percent', value: 10 })
        })
      )
    )
    fireEvent.change(screen.getByLabelText('Alert when free space is below'), {
      target: { value: 'gigabytes:10' }
    })
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          lowDiskAlert: expect.objectContaining({ kind: 'gigabytes', value: 10 })
        })
      )
    )
    await user.click(screen.getByRole('checkbox', { name: 'Idle applications' }))
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          scanCategories: expect.objectContaining({ unusedApps: false, userCaches: true })
        })
      )
    )
    fireEvent.change(screen.getByLabelText('Path to exclude'), {
      target: { value: '/Users/test/Library/Caches/keep' }
    })
    await user.click(screen.getByRole('button', { name: 'Add path' }))
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ neverTouchPaths: ['/Users/test/Library/Caches/keep'] })
      )
    )
    await user.click(screen.getByRole('button', { name: 'Show in Finder' }))
    expect(bridge.revealItem).toHaveBeenCalledWith('/Users/test/Library/Caches/keep')
    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(expect.objectContaining({ neverTouchPaths: [] }))
    )
    await user.click(screen.getByRole('button', { name: 'Choose folder' }))
    expect(bridge.pickFolder).toHaveBeenCalled()
    bridge.pickFolder.mockResolvedValueOnce('/Users/test/Library/Caches/from-picker')
    await user.click(screen.getByRole('button', { name: 'Choose folder' }))
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          neverTouchPaths: expect.arrayContaining(['/Users/test/Library/Caches/from-picker'])
        })
      )
    )
    await user.click(screen.getByRole('button', { name: 'Open permissions' }))
    expect(await screen.findByText('System access')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByText('Pro is not active.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('License key'), { target: { value: 'dh1.bad' } })
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    await waitFor(() => expect(bridge.activateLicense).toHaveBeenCalledWith('dh1.bad'))
    expect(await screen.findByText('That key is not valid for this product.')).toBeInTheDocument()
    bridge.activateLicense.mockResolvedValueOnce({ isPro: true })
    await user.click(screen.getByRole('button', { name: 'Activate' }))
    expect(await screen.findByText('Pro is active on this Mac.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Buy Pro' }))
    expect(bridge.openExternal).toHaveBeenCalledWith('https://www.diskheadroom.com/en/pro')
    await user.click(screen.getByRole('button', { name: 'Donate instead' }))
    expect(await screen.findByRole('button', { name: 'Sponsor on GitHub' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Donate' }))
    await user.click(await screen.findByRole('button', { name: 'Sponsor on GitHub' }))
    expect(bridge.openExternal).toHaveBeenCalledWith('https://github.com/sponsors/nettonucci')
    await user.click(screen.getByRole('button', { name: /github.com/ }))
    expect(bridge.openExternal).toHaveBeenCalledWith('https://github.com/nettonucci/diskheadroom')

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.change(screen.getByDisplayValue('English'), { target: { value: 'es' } })
    await waitFor(() =>
      expect(bridge.setSettings).toHaveBeenCalledWith(expect.objectContaining({ locale: 'es' }))
    )
  })

  it('responds to tray scan and donate callbacks', async () => {
    let scan: (() => void) | undefined
    let donate: (() => void) | undefined
    const bridge = api({
      onTrayScan: vi.fn((callback) => {
        scan = callback
        return vi.fn()
      }),
      onTrayDonate: vi.fn((callback) => {
        donate = callback
        return vi.fn()
      })
    })
    window.diskheadroom = bridge
    render(<App />)
    await screen.findByText('Reclaim storage')
    act(() => donate?.())
    expect(await screen.findByText('Keep the lights on')).toBeInTheDocument()
    act(() => scan?.())
    await waitFor(() =>
      expect(bridge.runScan).toHaveBeenCalledWith({
        unusedDays: 90,
        categories: DEFAULT_SCAN_CATEGORIES,
        largeFileMinBytes: 500 * 1024 * 1024
      })
    )
  })

  it('drives the low disk alert from the development-only Debug tab', async () => {
    const bridge = api()
    window.diskheadroom = bridge
    const user = userEvent.setup()
    render(<App />)
    await screen.findByText('Reclaim storage')

    await user.click(screen.getByRole('button', { name: 'Debug' }))
    expect(await screen.findByText('Low disk alert')).toBeInTheDocument()
    await waitFor(() => expect(bridge.debug?.lowDiskStatus).toHaveBeenCalled())
    expect(screen.getByText('never')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Simulate free space'), { target: { value: '5' } })
    await waitFor(() => expect(bridge.debug?.simulateFreePercent).toHaveBeenCalledWith(5))

    await user.click(screen.getByRole('button', { name: 'Run check now' }))
    await waitFor(() => expect(bridge.debug?.runLowDiskCheck).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Send test notification' }))
    await waitFor(() => expect(bridge.debug?.sendLowDiskNotification).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Reset cooldown' }))
    await waitFor(() => expect(bridge.debug?.resetLowDiskCooldown).toHaveBeenCalled())
  })

  it('falls back to a notice when the preload exposes no debug bridge', async () => {
    window.diskheadroom = api({ debug: null })
    render(<App />)
    await screen.findByText('Reclaim storage')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Debug' }))
    expect(await screen.findByText('Debug bridge unavailable.')).toBeInTheDocument()
  })
})
