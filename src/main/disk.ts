import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DiskInfo } from '../shared/types'

const execFileAsync = promisify(execFile)

export async function getDiskInfo(): Promise<DiskInfo> {
  const { stdout } = await execFileAsync('df', ['-k', '/'])
  const lines = stdout.trim().split('\n')
  const data = lines[1]
  if (!data) {
    throw new Error('Unable to read disk capacity')
  }

  const parts = data.split(/\s+/)
  const totalBytes = Number(parts[1]) * 1024
  const freeBytes = Number(parts[3]) * 1024

  return {
    mount: parts[8] ?? '/',
    totalBytes,
    // On APFS, df reports "/" as the sealed system volume, so its Used column
    // counts only the system snapshot while capacity and Available describe the
    // whole container. Deriving used from the container keeps the panel honest.
    usedBytes: Math.max(0, totalBytes - freeBytes),
    freeBytes
  }
}
