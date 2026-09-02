import { shell } from 'electron'
import { isNeverTouchPath, isSafePath } from './scanner'
import type { CleanRequest, CleanResult } from '../shared/types'

export interface TrashGuard {
  lastScanPaths: ReadonlySet<string>
  neverTouchPaths: string[]
}

export async function trashPaths(
  request: CleanRequest,
  sizeLookup: Map<string, number>,
  guard: TrashGuard = { lastScanPaths: new Set(), neverTouchPaths: [] }
): Promise<CleanResult> {
  const trashed: string[] = []
  const failed: { path: string; error: string }[] = []
  let bytesRequested = 0

  for (const path of request.paths) {
    if (!guard.lastScanPaths.has(path)) {
      failed.push({ path, error: 'Path was not in the last scan' })
      continue
    }
    if (!isSafePath(path)) {
      failed.push({ path, error: 'Path is outside the allowed scan roots' })
      continue
    }
    if (isNeverTouchPath(path, guard.neverTouchPaths)) {
      failed.push({ path, error: 'Path is on the never-touch list' })
      continue
    }

    bytesRequested += sizeLookup.get(path) ?? 0

    try {
      await shell.trashItem(path)
      trashed.push(path)
    } catch (error) {
      failed.push({
        path,
        error: error instanceof Error ? error.message : 'Could not move to Trash'
      })
    }
  }

  return { trashed, failed, bytesRequested }
}
