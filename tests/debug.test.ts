import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LowDiskDebugStatus } from '../src/shared/types'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>()
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
})

describe('debug IPC', () => {
  it('registers only the low-disk debug channels', () => {
    registerDebugIpc(watcher())
    expect([...mocks.handlers.keys()]).toEqual([
      'debug:low-disk-status',
      'debug:low-disk-simulate',
      'debug:low-disk-check',
      'debug:low-disk-reset',
      'debug:low-disk-notify'
    ])
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
