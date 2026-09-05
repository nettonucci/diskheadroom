import { describe, expect, it } from 'vitest'
import {
  categoryExtrasSelected,
  isLastUnselectedDuplicate,
  lastDuplicateCopiesToRefuse,
  selectionAfterCategoryToggle
} from '../src/shared/duplicates'
import type { ScanItem } from '../src/shared/types'

function dup(partial: Partial<ScanItem> & Pick<ScanItem, 'id' | 'path'>): ScanItem {
  return {
    categoryId: 'duplicateFiles',
    name: partial.name ?? partial.id,
    bytes: 10,
    selectedByDefault: false,
    optional: true,
    lastUsedAt: null,
    daysIdle: null,
    duplicateGroupId: 'g1',
    ...partial
  }
}

describe('duplicate keep-one-copy helpers', () => {
  const keeper = dup({ id: 'old', path: '/Users/test/old.bin', name: 'old.bin', duplicateKeep: true })
  const extra = dup({ id: 'new', path: '/Users/test/new.bin', name: 'new.bin', duplicateKeep: false })

  it('locks the last unselected copy in a group', () => {
    expect(isLastUnselectedDuplicate(keeper, [keeper, extra], { old: false, new: true })).toBe(true)
    expect(isLastUnselectedDuplicate(extra, [keeper, extra], { old: false, new: false })).toBe(false)
    expect(isLastUnselectedDuplicate(keeper, [keeper, extra], { old: true, new: false })).toBe(false)
  })

  it('selects extras and never the keeper when turning a group on', () => {
    const next = selectionAfterCategoryToggle(
      [keeper, extra],
      ['old', 'new'],
      true,
      { old: false, new: false }
    )
    expect(next).toEqual({ old: false, new: true })
    expect(selectionAfterCategoryToggle([keeper, extra], ['old', 'new'], false, next)).toEqual({
      old: false,
      new: false
    })
  })

  it('treats extras-selected as the category all-on state', () => {
    expect(categoryExtrasSelected([keeper, extra], { old: false, new: true })).toBe(true)
    expect(categoryExtrasSelected([keeper, extra], { old: false, new: false })).toBe(false)
  })

  it('refuses trashing the last copy in a hash group', () => {
    expect(
      lastDuplicateCopiesToRefuse(
        [keeper.path, extra.path],
        [keeper, extra]
      )
    ).toEqual(new Set([keeper.path]))
    expect(lastDuplicateCopiesToRefuse([extra.path], [keeper, extra])).toEqual(new Set())
  })
})
