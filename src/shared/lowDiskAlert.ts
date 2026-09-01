import {
  GIGABYTE_BYTES,
  LOW_DISK_ALERT_COOLDOWN_MS,
  type LowDiskAlertSettings
} from './constants'
import type { DiskInfo } from './types'

export function isBelowLowDiskThreshold(
  disk: Pick<DiskInfo, 'totalBytes' | 'freeBytes'>,
  alert: LowDiskAlertSettings
): boolean {
  if (!Number.isFinite(disk.totalBytes) || disk.totalBytes <= 0) return false
  if (!Number.isFinite(disk.freeBytes) || disk.freeBytes < 0) return false
  if (alert.kind === 'percent') {
    return (disk.freeBytes / disk.totalBytes) * 100 < alert.value
  }
  return disk.freeBytes < alert.value * GIGABYTE_BYTES
}

export function shouldFireLowDiskAlert(input: {
  enabled: boolean
  belowThreshold: boolean
  now: number
  lastFiredAt: number | null
  cooldownMs?: number
}): boolean {
  if (!input.enabled || !input.belowThreshold) return false
  if (input.lastFiredAt == null) return true
  const cooldown = input.cooldownMs ?? LOW_DISK_ALERT_COOLDOWN_MS
  return input.now - input.lastFiredAt >= cooldown
}

export function freeSpacePercent(disk: Pick<DiskInfo, 'totalBytes' | 'freeBytes'>): number {
  if (!Number.isFinite(disk.totalBytes) || disk.totalBytes <= 0) return 0
  return Math.max(0, Math.round((disk.freeBytes / disk.totalBytes) * 100))
}
