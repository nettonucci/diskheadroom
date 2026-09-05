import type { ScanItem } from './types'

export interface DuplicateTrashRef {
  path: string
  duplicateGroupId?: string
  duplicateKeep?: boolean
}

/** True when checking this row would leave the hash group with zero unselected copies. */
export function isLastUnselectedDuplicate(
  item: ScanItem,
  items: readonly ScanItem[],
  selected: Record<string, boolean>
): boolean {
  if (!item.duplicateGroupId || selected[item.id]) return false
  const group = items.filter((entry) => entry.duplicateGroupId === item.duplicateGroupId)
  if (group.length < 2) return false
  return group.every((entry) => entry.id === item.id || Boolean(selected[entry.id]))
}

/** Select extras in each hash group; never mark the last remaining copy. */
export function selectionAfterCategoryToggle(
  items: readonly ScanItem[],
  ids: readonly string[],
  value: boolean,
  current: Record<string, boolean>
): Record<string, boolean> {
  const next = { ...current }
  const visible = items.filter((item) => ids.includes(item.id))
  if (!value) {
    for (const id of ids) next[id] = false
    return next
  }

  const grouped = new Map<string, ScanItem[]>()
  const ungrouped: ScanItem[] = []
  for (const item of visible) {
    if (!item.duplicateGroupId) {
      ungrouped.push(item)
      continue
    }
    const list = grouped.get(item.duplicateGroupId) ?? []
    list.push(item)
    grouped.set(item.duplicateGroupId, list)
  }

  for (const item of ungrouped) next[item.id] = true

  for (const group of grouped.values()) {
    const keeper = group.find((item) => item.duplicateKeep) ?? group[0]
    for (const item of group) {
      next[item.id] = item.id !== keeper.id
    }
  }

  return next
}

export function categoryExtrasSelected(
  items: readonly ScanItem[],
  selected: Record<string, boolean>
): boolean {
  if (items.length === 0) return false
  if (!items.some((item) => item.duplicateGroupId)) {
    return items.every((item) => Boolean(selected[item.id]))
  }
  const extras = items.filter((item) => !item.duplicateKeep)
  return extras.length > 0 && extras.every((item) => Boolean(selected[item.id]))
}

/**
 * If a trash request would remove every member of a hash group, refuse the
 * keeper (or the first path) so at least one copy stays on disk.
 */
export function lastDuplicateCopiesToRefuse(
  requestedPaths: readonly string[],
  lastItems: readonly DuplicateTrashRef[]
): Set<string> {
  const requested = new Set(requestedPaths)
  const byGroup = new Map<string, DuplicateTrashRef[]>()
  for (const item of lastItems) {
    if (!item.duplicateGroupId) continue
    const list = byGroup.get(item.duplicateGroupId) ?? []
    list.push(item)
    byGroup.set(item.duplicateGroupId, list)
  }

  const refuse = new Set<string>()
  for (const group of byGroup.values()) {
    if (group.length < 2) continue
    const remaining = group.filter((item) => !requested.has(item.path))
    if (remaining.length > 0) continue
    const keeper = group.find((item) => item.duplicateKeep) ?? group[0]
    refuse.add(keeper.path)
  }
  return refuse
}
