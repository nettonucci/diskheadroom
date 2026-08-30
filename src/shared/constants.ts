export const SPONSORS_URL = 'https://github.com/sponsors/nettonucci'
export const REPO_URL = 'https://github.com/nettonucci/diskheadroom'
export const APP_NAME = 'Disk Headroom'

export const UNUSED_DAY_OPTIONS = [30, 90, 180, 365] as const
export type UnusedDays = (typeof UNUSED_DAY_OPTIONS)[number]
export const DEFAULT_UNUSED_DAYS: UnusedDays = 90
