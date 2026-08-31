import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/renderer/src/App'

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
  locale: 'en' as const
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
    openExternal: vi.fn().mockResolvedValue(undefined),
    copyText: vi.fn().mockResolvedValue(undefined),
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)

    expect(await screen.findByText('Reclaim storage')).toBeInTheDocument()
    act(() => progressListeners[0]?.({ phase: 'progress.starting', percent: 25 }))
    await user.click(screen.getByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByText('Review before cleaning')).toBeInTheDocument()
    expect(screen.getByText('Cache A')).toBeInTheDocument()
    expect(screen.getByText('Old App')).toBeInTheDocument()
    expect(screen.getByText(/Last used/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select group' }))
    expect(screen.getByText(/2 selected/)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Clear group' })[1])
    expect(screen.getByText(/1 selected/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    await waitFor(() => expect(bridge.trashItems).toHaveBeenCalled())
    expect(await screen.findByText(/Moved 1 item/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    await waitFor(() => expect(bridge.runScan).toHaveBeenCalledTimes(2))
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))

    expect(await screen.findByText('Docker Desktop disk image')).toBeInTheDocument()
    expect(screen.getByText(/High impact/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Move to Trash' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/Docker Desktop/))
    await waitFor(() => expect(bridge.trashItems).toHaveBeenCalled())
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
  })

  it('does not clean when confirmation is cancelled', async () => {
    const bridge = api()
    window.diskheadroom = bridge
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    await user.click(await screen.findByRole('button', { name: 'Move to Trash' }))
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
        { ...result.items[0], id: 'd', name: 'Cache D', path: '/Users/test/Library/Caches/d' }
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Scan this Mac' }))
    expect(await screen.findByText('Trash')).toBeInTheDocument()
    expect(screen.getByText(/Never recorded/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Move to Trash' }))
    expect(await screen.findByText(/2 items could not be moved/)).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: 'Open permissions' }))
    expect(await screen.findByText('System access')).toBeInTheDocument()

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
    await waitFor(() => expect(bridge.runScan).toHaveBeenCalled())
  })
})
