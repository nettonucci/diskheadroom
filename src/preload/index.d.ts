import type { DiskHeadroomApi } from './index'

declare global {
  interface Window {
    diskheadroom: DiskHeadroomApi
  }
}

export {}
