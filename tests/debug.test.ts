import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LowDiskDebugStatus } from '../src/shared/types'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  deactivateLicense: vi.fn()
}))

vi.mock('electron', () => {
  const module = {
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
        mocks.handlers.set(channel, handler)
      }
    }
  }
  return { default: module, ...module }
})

vi.mock('../src/main/license', () => ({
  deactivateLicense: mocks.deactivateLicense
}))

import { registerDebugIpc } from '../src/main/debug'

const status = { belowThreshold: true, lastFiredAt: null } as unknown as LowDiskDebugStatus

function watcher(): Parameters<typeof registerDebugIpc>[0] {
  return {
    setSettings: vi.fn(),
    checkNow: vi.fn().mockResolvedValue(undefined),
    resetCooldown: vi.fn().mockResolvedValue(undefined),
    simulateFreePercent: vi.fn(),
    notifyNow: vi.fn().mockResolvedValue(true),
    getStatus: vi.fn().mockResolvedValue(status),
    stop: vi.fn()
  }
}

const call = (channel: string, ...args: unknown[]): unknown => {
  const handler = mocks.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler ${channel}`)
  return handler({}, ...args)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.deactivateLicense.mockResolvedValue({ isPro: false })
})

describe('debug IPC', () => {
  it('registers only the low-disk debug channels', () => {
    registerDebugIpc(watcher())
    expect([...mocks.handlers.keys()]).toEqual([
      'debug:low-disk-status',
      'debug:low-disk-simulate',
      'debug:low-disk-check',
      'debug:low-disk-reset',
      'debug:low-disk-notify',
      'debug:license-deactivate'
    ])
  })

  it('drops the stored Pro license so the free state can be retested', async () => {
    registerDebugIpc(watcher())

    await expect(call('debug:license-deactivate')).resolves.toEqual({ isPro: false })
    expect(mocks.deactivateLicense).toHaveBeenCalledTimes(1)
  })

  it('delegates to the watcher and answers with a fresh status', async () => {
    const controller = watcher()
    registerDebugIpc(controller)

    await expect(call('debug:low-disk-status')).resolves.toBe(status)

    await call('debug:low-disk-simulate', 5)
    expect(controller.simulateFreePercent).toHaveBeenCalledWith(5)
    await call('debug:low-disk-simulate', 'off')
    expect(controller.simulateFreePercent).toHaveBeenLastCalledWith(null)

    await expect(call('debug:low-disk-check')).resolves.toBe(status)
    expect(controller.checkNow).toHaveBeenCalled()

    await expect(call('debug:low-disk-reset')).resolves.toBe(status)
    expect(controller.resetCooldown).toHaveBeenCalled()

    await expect(call('debug:low-disk-notify')).resolves.toEqual({ shown: true, status })
    expect(controller.notifyNow).toHaveBeenCalled()
  })
})
