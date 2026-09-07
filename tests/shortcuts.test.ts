import { describe, expect, it } from 'vitest'
import { APP_SHORTCUTS, matchAppShortcut } from '../src/renderer/src/lib/shortcuts'

function event(overrides: Partial<Parameters<typeof matchAppShortcut>[0]>): Parameters<
  typeof matchAppShortcut
>[0] {
  return {
    key: 'r',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    ...overrides
  }
}

describe('matchAppShortcut', () => {
  it('maps Command-R to scan and Command-F to the results filter', () => {
    expect(matchAppShortcut(event({ key: 'r' }))).toBe('scan')
    expect(matchAppShortcut(event({ key: 'R' }))).toBe('scan')
    expect(matchAppShortcut(event({ key: 'f' }))).toBe('focusResultsFilter')
    expect(APP_SHORTCUTS.scan.chord).toBe('⌘R')
    expect(APP_SHORTCUTS.focusResultsFilter.chord).toBe('⌘F')
  })

  it('ignores chords that would steal reload, typing modifiers, or repeats', () => {
    expect(matchAppShortcut(event({ metaKey: false }))).toBeNull()
    expect(matchAppShortcut(event({ ctrlKey: true }))).toBeNull()
    expect(matchAppShortcut(event({ altKey: true }))).toBeNull()
    expect(matchAppShortcut(event({ shiftKey: true }))).toBeNull()
    expect(matchAppShortcut(event({ key: 's' }))).toBeNull()
    expect(matchAppShortcut(event({ repeat: true }))).toBeNull()
    expect(matchAppShortcut(event({ isComposing: true }))).toBeNull()
  })
})
