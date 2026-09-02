import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GIGABYTE_BYTES } from '../src/shared/constants'
import type { HeadroomSample } from '../src/shared/types'

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  getPath: vi.fn(() => '/tmp/diskheadroom')
}))

vi.mock('node:fs/promises', () => {
  const module = { readFile: mocks.readFile, writeFile: mocks.writeFile, mkdir: mocks.mkdir }
  return { default: module, ...module }
})

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath }
}))

import {
  getHeadroomForecast,
  loadHeadroomSamples,
  recordHeadroomSample,
  saveHeadroomSamples
} from '../src/main/forecast'

const totalBytes = 100 * GIGABYTE_BYTES
const now = Date.now()
const sampleA: HeadroomSample = {
  timestamp: now - 86_400_000,
  freeBytes: 40 * GIGABYTE_BYTES,
  totalBytes
}
const sampleB: HeadroomSample = {
  timestamp: now,
  freeBytes: 38 * GIGABYTE_BYTES,
  totalBytes
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.readFile.mockRejectedValue(new Error('ENOENT'))
  mocks.mkdir.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue(undefined)
})

describe('main process headroom storage and forecast', () => {
  it('loads samples from disk or falls back to empty array on missing file', async () => {
    await expect(loadHeadroomSamples()).resolves.toEqual([])

    mocks.readFile.mockResolvedValue(JSON.stringify([sampleA, sampleB]))
    await expect(loadHeadroomSamples()).resolves.toEqual([sampleA, sampleB])
  })

  it('handles invalid json on disk gracefully', async () => {
    mocks.readFile.mockResolvedValue('not-valid-json')
    await expect(loadHeadroomSamples()).resolves.toEqual([])
  })

  it('saves pruned samples to userData directory', async () => {
    await saveHeadroomSamples([sampleA])
    expect(mocks.mkdir).toHaveBeenCalledWith('/tmp/diskheadroom', { recursive: true })
    expect(mocks.writeFile).toHaveBeenCalledWith(
      '/tmp/diskheadroom/headroom-samples.json',
      expect.any(String),
      'utf8'
    )
  })

  it('records new samples with minimum interval debounce', async () => {
    // 1st recording succeeds
    const recorded1 = await recordHeadroomSample({
      freeBytes: 40 * GIGABYTE_BYTES,
      totalBytes
    })
    expect(recorded1).toHaveLength(1)

    // 2nd recording immediately after should be ignored (debounced)
    const recorded2 = await recordHeadroomSample({
      freeBytes: 39 * GIGABYTE_BYTES,
      totalBytes
    })
    expect(recorded2).toHaveLength(1)
  })

  it('generates forecast taking settings into account', async () => {
    mocks.readFile.mockResolvedValue(JSON.stringify([sampleA, sampleB]))

    // With isPro: false -> gated
    const gated = await getHeadroomForecast({
      isPro: false,
      currentFreeBytes: 38 * GIGABYTE_BYTES,
      totalBytes
    })
    expect(gated.status).toBe('gated')

    // With isPro: true -> declining forecast
    const active = await getHeadroomForecast({
      isPro: true,
      currentFreeBytes: 38 * GIGABYTE_BYTES,
      totalBytes,
      alertSettings: { enabled: true, kind: 'gigabytes', value: 10 }
    })
    expect(active.status).toBe('declining')
    expect(active.daysRemaining).toBeDefined()
  })
})
