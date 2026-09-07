export type AppShortcut = 'scan' | 'focusResultsFilter'

export const APP_SHORTCUTS: Record<
  AppShortcut,
  { key: string; chord: string; aria: string }
> = {
  scan: { key: 'r', chord: '⌘R', aria: 'Meta+R' },
  focusResultsFilter: { key: 'f', chord: '⌘F', aria: 'Meta+F' }
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat' | 'isComposing'
>

export function matchAppShortcut(event: ShortcutEvent): AppShortcut | null {
  if (event.isComposing || event.repeat) return null
  if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null
  const key = event.key?.toLowerCase()
  if (!key) return null
  if (key === APP_SHORTCUTS.scan.key) return 'scan'
  if (key === APP_SHORTCUTS.focusResultsFilter.key) return 'focusResultsFilter'
  return null
}
