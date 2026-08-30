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
  const totalKiB = Number(parts[1])
  const usedKiB = Number(parts[2])
  const availKiB = Number(parts[3])

  return {
    mount: parts[8] ?? '/',
    totalBytes: totalKiB * 1024,
    usedBytes: usedKiB * 1024,
    freeBytes: availKiB * 1024
  }
}
