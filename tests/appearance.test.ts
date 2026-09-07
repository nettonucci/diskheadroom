import { afterEach, describe, expect, it, vi } from 'vitest'

const nativeTheme = vi.hoisted(() => ({
  themeSource: 'system' as 'system' | 'dark' | 'light',
  shouldUseDarkColors: true,
  on: vi.fn()
}))

vi.mock('electron', () => ({
  nativeTheme
}))

import { applyNativeAppearance } from '../src/main/appearance'
import { applyDocumentTheme } from '../src/renderer/src/lib/theme'
import { WINDOW_BACKGROUND } from '../src/shared/appearance'

describe('native appearance', () => {
  it('sets themeSource and the window background for a locked light look', () => {
    nativeTheme.shouldUseDarkColors = true
    const win = { setBackgroundColor: vi.fn(), isDestroyed: () => false }
    applyNativeAppearance('light', win as never)
    expect(nativeTheme.themeSource).toBe('light')
    expect(win.setBackgroundColor).toHaveBeenCalledWith(WINDOW_BACKGROUND.light)
  })

  it('follows the system when appearance is system', () => {
    nativeTheme.shouldUseDarkColors = false
    const win = { setBackgroundColor: vi.fn(), isDestroyed: () => false }
    applyNativeAppearance('system', win as never)
    expect(nativeTheme.themeSource).toBe('system')
    expect(win.setBackgroundColor).toHaveBeenCalledWith(WINDOW_BACKGROUND.light)
  })

  it('skips a window that was already destroyed while quitting', () => {
    const win = { setBackgroundColor: vi.fn(), isDestroyed: () => true }
    expect(() => applyNativeAppearance('dark', win as never)).not.toThrow()
    expect(win.setBackgroundColor).not.toHaveBeenCalled()
  })
})

describe('document theme', () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme
    document.documentElement.style.colorScheme = ''
  })

  it('locks html to light without watching the system', () => {
    const stop = applyDocumentTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    stop()
  })

  it('follows prefers-color-scheme while appearance is system', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>()
    const media = {
      matches: false,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener)
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener)
      }
    }
    window.matchMedia = vi.fn().mockReturnValue(media) as never
    const stop = applyDocumentTheme('system')
    expect(document.documentElement.dataset.theme).toBe('light')
    media.matches = true
    for (const listener of listeners) listener({ matches: true } as MediaQueryListEvent)
    expect(document.documentElement.dataset.theme).toBe('dark')
    stop()
    expect(listeners.size).toBe(0)
  })
})
