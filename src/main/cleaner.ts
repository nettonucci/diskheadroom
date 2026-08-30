import { shell } from 'electron'
import { isSafePath } from './scanner'
import type { CleanRequest, CleanResult } from '../shared/types'

export async function trashPaths(request: CleanRequest, sizeLookup: Map<string, number>): Promise<CleanResult> {
  const trashed: string[] = []
  const failed: { path: string; error: string }[] = []
  let bytesRequested = 0

  for (const path of request.paths) {
    if (!isSafePath(path)) {
      failed.push({ path, error: 'Path is outside the allowed scan roots' })
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
