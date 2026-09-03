import { PRO_SCAN_CATEGORY_IDS, type ScanCategoryFlags } from './constants'

/** Single renderer-facing gate for every `paid` surface. */
export function isProEntitled(isPro: boolean): boolean {
  return isPro === true
}

/** Main-process gate: paid scan walks stay off unless the signed key verifies. */
export function gateProScanCategories(
  categories: ScanCategoryFlags,
  isPro: boolean
): ScanCategoryFlags {
  if (isProEntitled(isPro)) return categories
  const next = { ...categories }
  for (const id of PRO_SCAN_CATEGORY_IDS) {
    next[id] = false
  }
  return next
}
