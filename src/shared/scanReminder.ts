import { DAY_MS } from './constants'

function laterTimestamp(a: number | null, b: number | null): number | null {
  if (a == null) return b
  if (b == null) return a
  return Math.max(a, b)
}

export function shouldFireScanReminder(input: {
  enabled: boolean
  now: number
  intervalDays: number
  lastRemindedAt: number | null
  lastScanAt: number | null
}): boolean {
  if (!input.enabled) return false
  if (!Number.isFinite(input.intervalDays) || input.intervalDays <= 0) return false
  const last = laterTimestamp(input.lastRemindedAt, input.lastScanAt)
  if (last == null) return false
  return input.now - last >= input.intervalDays * DAY_MS
}
