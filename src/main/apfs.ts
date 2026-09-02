import { execFile } from 'node:child_process'
import type {
  ApfsSnapshot,
  ApfsStorageExplanation,
  ApfsVolumeUsage
} from '../shared/types'
import { getDiskInfo } from './disk'

/**
 * Executes /usr/sbin/diskutil with arguments and resolves stdout string.
 */
function execDiskutil(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/usr/sbin/diskutil', args, (error, stdout) => {
      if (error) {
        reject(error)
      } else {
        resolve(typeof stdout === 'string' ? stdout : String(stdout ?? ''))
      }
    })
  })
}

/**
 * Parses snapshot dates from standard APFS snapshot naming conventions.
 */
function extractSnapshotDate(name: string): string | null {
  const tmMatch = name.match(/TimeMachine\.(\d{4}-\d{2}-\d{2}-\d{6})/)
  if (tmMatch && tmMatch[1]) {
    const raw = tmMatch[1]
    const parts = raw.split('-')
    if (parts.length === 4 && parts[0] && parts[1] && parts[2] && parts[3]) {
      const year = parts[0]
      const month = parts[1]
      const day = parts[2]
      const time = parts[3]
      const hour = time.slice(0, 2)
      const min = time.slice(2, 4)
      const sec = time.slice(4, 6)
      return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`
    }
  }
  return null
}

/**
 * Lightweight recursive-descent plist parser for APFS diskutil outputs.
 */
function parsePlistXml(xml: string): unknown {
  let pos = 0
  const len = xml.length

  function skipWhitespace(): void {
    while (pos < len && /\s/.test(xml[pos] ?? '')) {
      pos++
    }
  }

  function parseValue(): unknown {
    skipWhitespace()
    if (pos >= len) return null

    if (xml.startsWith('<true/>', pos)) {
      pos += 7
      return true
    }
    if (xml.startsWith('<false/>', pos)) {
      pos += 8
      return false
    }
    if (xml.startsWith('<string>', pos)) {
      pos += 8
      const end = xml.indexOf('</string>', pos)
      if (end === -1) return ''
      const str = xml.slice(pos, end)
      pos = end + 9
      return str
    }
    if (xml.startsWith('<string/>', pos)) {
      pos += 9
      return ''
    }
    if (xml.startsWith('<integer>', pos)) {
      pos += 9
      const end = xml.indexOf('</integer>', pos)
      if (end === -1) return 0
      const num = Number(xml.slice(pos, end).trim())
      pos = end + 10
      return Number.isFinite(num) ? num : 0
    }
    if (xml.startsWith('<array>', pos) || xml.startsWith('<array/>', pos)) {
      if (xml.startsWith('<array/>', pos)) {
        pos += 8
        return []
      }
      pos += 7
      const arr: unknown[] = []
      while (pos < len) {
        skipWhitespace()
        if (xml.startsWith('</array>', pos)) {
          pos += 8
          break
        }
        const val = parseValue()
        if (val !== null && val !== undefined) {
          arr.push(val)
        } else {
          const nextTag = xml.indexOf('>', pos)
          if (nextTag !== -1) pos = nextTag + 1
          else break
        }
      }
      return arr
    }
    if (xml.startsWith('<dict>', pos) || xml.startsWith('<dict/>', pos)) {
      if (xml.startsWith('<dict/>', pos)) {
        pos += 7
        return {}
      }
      pos += 6
      const obj: Record<string, unknown> = {}
      while (pos < len) {
        skipWhitespace()
        if (xml.startsWith('</dict>', pos)) {
          pos += 7
          break
        }
        if (xml.startsWith('<key>', pos)) {
          pos += 5
          const keyEnd = xml.indexOf('</key>', pos)
          if (keyEnd === -1) break
          const key = xml.slice(pos, keyEnd).trim()
          pos = keyEnd + 6
          const val = parseValue()
          if (key) {
            obj[key] = val
          }
        } else {
          const nextTag = xml.indexOf('>', pos)
          if (nextTag !== -1) pos = nextTag + 1
          else break
        }
      }
      return obj
    }
    return null
  }

  const dictStart = xml.indexOf('<dict>')
  if (dictStart !== -1) {
    pos = dictStart
    return parseValue()
  }
  return null
}

/**
 * Parses APFS snapshot listings from diskutil plist or plain text output.
 */
export function parseApfsSnapshots(input: string): ApfsSnapshot[] {
  if (!input || typeof input !== 'string') return []
  const trimmed = input.trim()

  if (trimmed.includes('<plist') || trimmed.includes('<dict>')) {
    try {
      const parsed = parsePlistXml(trimmed) as { Snapshots?: Array<Record<string, unknown>> } | null

      if (parsed && Array.isArray(parsed.Snapshots)) {
        return parsed.Snapshots.map((item) => {
          const uuid = String(item.SnapshotUUID ?? item.uuid ?? '')
          const name = String(item.SnapshotName ?? item.name ?? '')
          const xid = typeof item.SnapshotXID === 'number' ? item.SnapshotXID : undefined
          const purgeable = item.Purgeable === true
          const isSystem =
            name.startsWith('com.apple.os.update-') ||
            name.includes('MSUPrepareUpdate') ||
            name.includes('com.apple.os.update')

          return {
            uuid,
            name,
            xid,
            purgeable,
            isSystem,
            date: extractSnapshotDate(name)
          }
        }).filter((s) => s.uuid.length > 0 || s.name.length > 0)
      }
    } catch {
      return []
    }
  }

  const snapshots: ApfsSnapshot[] = []
  const blocks = trimmed.split(/(?:^|\n)\+--\s+/)

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i]
    if (!block) continue
    const lines = block.split('\n')
    const firstLine = lines[0]?.trim() ?? ''
    const uuidMatch = firstLine.match(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/)
    const uuid = uuidMatch ? uuidMatch[0] : firstLine

    const nameMatch = block.match(/Name:\s*([^\n]+)/)
    const name = nameMatch ? nameMatch[1]?.trim() ?? '' : ''

    const xidMatch = block.match(/XID:\s*(\d+)/)
    const xid = xidMatch && xidMatch[1] ? Number(xidMatch[1]) : undefined

    const purgeableMatch = block.match(/Purgeable:\s*(Yes|No)/i)
    const purgeable = purgeableMatch ? purgeableMatch[1]?.toLowerCase() === 'yes' : false

    if (uuid || name) {
      const isSystem =
        name.startsWith('com.apple.os.update-') ||
        name.includes('MSUPrepareUpdate') ||
        name.includes('com.apple.os.update')

      snapshots.push({
        uuid,
        name,
        xid,
        purgeable,
        isSystem,
        date: extractSnapshotDate(name)
      })
    }
  }

  if (snapshots.length === 0 && trimmed.startsWith('Snapshots for volume group')) {
    const lines = trimmed.split('\n').slice(1)
    for (const line of lines) {
      const name = line.trim()
      if (name && !name.startsWith('Snapshots for')) {
        const isSystem = name.startsWith('com.apple.os.update-')
        snapshots.push({
          uuid: name,
          name,
          purgeable: false,
          isSystem,
          date: extractSnapshotDate(name)
        })
      }
    }
  }

  return snapshots
}

/**
 * Parses APFS container and volume allocation structures.
 */
export function parseApfsContainers(input: string): {
  containerSize: number
  containerFree: number
  containerUsed: number
  volumes: ApfsVolumeUsage[]
} | null {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()

  if (trimmed.includes('<plist') || trimmed.includes('<dict>')) {
    try {
      const parsed = parsePlistXml(trimmed) as {
        Containers?: Array<{
          CapacityCeiling?: number
          CapacityFree?: number
          Volumes?: Array<{
            Name?: string
            CapacityInUse?: number
            MountPoint?: string
            Roles?: string[]
          }>
        }>
      } | null

      if (parsed && Array.isArray(parsed.Containers) && parsed.Containers.length > 0) {
        const target =
          parsed.Containers.find((c) =>
            c.Volumes?.some((v) => v.MountPoint === '/' || v.MountPoint === '/System/Volumes/Data')
          ) ?? parsed.Containers[0]

        if (target) {
          const containerSize = typeof target.CapacityCeiling === 'number' ? target.CapacityCeiling : 0
          const containerFree = typeof target.CapacityFree === 'number' ? target.CapacityFree : 0
          const volumes: ApfsVolumeUsage[] = (target.Volumes ?? []).map((v) => {
            const role = Array.isArray(v.Roles) && v.Roles[0] ? v.Roles[0] : 'Data'
            return {
              name: String(v.Name ?? ''),
              role,
              mountPoint: v.MountPoint ? String(v.MountPoint) : null,
              usedBytes: typeof v.CapacityInUse === 'number' ? v.CapacityInUse : 0
            }
          })
          const containerUsed = volumes.reduce((sum, v) => sum + v.usedBytes, 0)

          return {
            containerSize,
            containerFree,
            containerUsed,
            volumes
          }
        }
      }
    } catch {
      return null
    }
  }

  const ceilingMatch = trimmed.match(/Size\s*\(Capacity Ceiling\):\s*(\d+)\s*B/)
  const freeMatch = trimmed.match(/Capacity Not Allocated:\s*(\d+)\s*B/)
  const usedMatch = trimmed.match(/Capacity In Use By Volumes:\s*(\d+)\s*B/)

  if (ceilingMatch && ceilingMatch[1]) {
    const containerSize = Number(ceilingMatch[1])
    const containerFree = freeMatch && freeMatch[1] ? Number(freeMatch[1]) : 0
    const containerUsed = usedMatch && usedMatch[1] ? Number(usedMatch[1]) : 0

    const volumes: ApfsVolumeUsage[] = []
    const volumeBlocks = trimmed.split(/\+->\s+Volume\s+/)

    for (let i = 1; i < volumeBlocks.length; i++) {
      const block = volumeBlocks[i]
      if (!block) continue
      const roleMatch = block.match(/Role\):\s*\w+\s*\(([^)]+)\)/)
      const nameMatch = block.match(/Name:\s*([^\n(]+)/)
      const mountMatch = block.match(/Mount Point:\s*([^\n]+)/)
      const bytesMatch = block.match(/Capacity Consumed:\s*(\d+)\s*B/)

      const name = nameMatch && nameMatch[1] ? nameMatch[1].trim() : ''
      const role = roleMatch && roleMatch[1] ? roleMatch[1].trim() : 'Data'
      const mount = mountMatch && mountMatch[1] ? mountMatch[1].trim() : null
      const usedBytes = bytesMatch && bytesMatch[1] ? Number(bytesMatch[1]) : 0

      volumes.push({
        name,
        role,
        mountPoint: mount,
        usedBytes
      })
    }

    return {
      containerSize,
      containerFree,
      containerUsed,
      volumes
    }
  }

  return null
}

/**
 * Gathers complete APFS storage explanation including container breakdown and snapshots.
 */
export async function getApfsExplanation(): Promise<ApfsStorageExplanation> {
  const disk = await getDiskInfo()

  let snapshots: ApfsSnapshot[] = []
  try {
    const stdout = await execDiskutil(['apfs', 'listSnapshots', '-plist', '/'])
    snapshots = parseApfsSnapshots(stdout)
  } catch {
    try {
      const stdout = await execDiskutil(['apfs', 'listSnapshots', '/'])
      snapshots = parseApfsSnapshots(stdout)
    } catch {
      snapshots = []
    }
  }

  let parsedContainer: ReturnType<typeof parseApfsContainers> = null
  try {
    const stdout = await execDiskutil(['apfs', 'list', '-plist'])
    parsedContainer = parseApfsContainers(stdout)
  } catch {
    try {
      const stdout = await execDiskutil(['apfs', 'list'])
      parsedContainer = parseApfsContainers(stdout)
    } catch {
      parsedContainer = null
    }
  }

  const containerSize = parsedContainer?.containerSize ?? disk.totalBytes
  const containerFree = parsedContainer?.containerFree ?? disk.freeBytes
  const volumes = parsedContainer?.volumes ?? []

  const systemBytes = volumes
    .filter((v) => v.role === 'System' || v.role === 'Preboot' || v.role === 'Recovery')
    .reduce((sum, v) => sum + v.usedBytes, 0)
  const dataBytes = volumes
    .filter((v) => v.role === 'Data' || v.role === 'User')
    .reduce((sum, v) => sum + v.usedBytes, 0)
  const otherVolumesBytes = volumes
    .filter(
      (v) =>
        v.role !== 'System' &&
        v.role !== 'Preboot' &&
        v.role !== 'Recovery' &&
        v.role !== 'Data' &&
        v.role !== 'User'
    )
    .reduce((sum, v) => sum + v.usedBytes, 0)

  const purgeableSnapshots = snapshots.filter((s) => s.purgeable)
  const purgeableEstimatedBytes = Math.max(0, disk.freeBytes - containerFree)

  return {
    isApfs: true,
    containerSize,
    containerFree,
    purgeableBytes: purgeableEstimatedBytes,
    breakdown: {
      systemBytes: systemBytes > 0 ? systemBytes : Math.round(disk.totalBytes * 0.05),
      dataBytes: dataBytes > 0 ? dataBytes : disk.usedBytes,
      otherVolumesBytes
    },
    snapshotCount: snapshots.length,
    purgeableSnapshotCount: purgeableSnapshots.length,
    snapshots,
    explanation:
      'APFS containers share free space dynamically across volumes. Local Time Machine snapshots are preserved locally until disk headroom becomes tight or snapshots are rotated.'
  }
}
