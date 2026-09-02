import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseApfsContainers, parseApfsSnapshots } from '../src/main/apfs'

const fixturesDir = join(__dirname, 'fixtures')

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8')
}

describe('parseApfsSnapshots', () => {
  it('parses plist snapshots output correctly', () => {
    const plistContent = readFixture('diskutil_snapshots.plist')
    const snapshots = parseApfsSnapshots(plistContent)

    expect(snapshots).toHaveLength(3)
    expect(snapshots[0].name).toBe('com.apple.os.update-9E3B7EFBB732B00D98BF266D7444FDC8348CC3B2CCEF551FF262CA73E4E23BAE')
    expect(snapshots[0].uuid).toBe('0184540F-CD97-4494-BC29-29DF5264424F')
    expect(snapshots[0].purgeable).toBe(false)
    expect(snapshots[0].isSystem).toBe(true)

    expect(snapshots[1].name).toBe('com.apple.TimeMachine.2025-01-15-103000.local')
    expect(snapshots[1].uuid).toBe('03A9C2DB-E5EE-4A95-B393-3048E1CFD44F')
    expect(snapshots[1].purgeable).toBe(true)
    expect(snapshots[1].isSystem).toBe(false)

    expect(snapshots[2].name).toBe('com.apple.os.update-MSUPrepareUpdate')
    expect(snapshots[2].uuid).toBe('C1B5256B-980A-422C-BAE0-03C2E408212A')
    expect(snapshots[2].purgeable).toBe(false)
    expect(snapshots[2].isSystem).toBe(true)
  })

  it('parses plain text snapshots output fallback', () => {
    const textContent = readFixture('diskutil_snapshots.txt')
    const snapshots = parseApfsSnapshots(textContent)

    expect(snapshots).toHaveLength(3)
    expect(snapshots[0].name).toBe('com.apple.os.update-9E3B7EFBB732B00D98BF266D7444FDC8348CC3B2CCEF551FF262CA73E4E23BAE')
    expect(snapshots[0].uuid).toBe('0184540F-CD97-4494-BC29-29DF5264424F')
    expect(snapshots[0].purgeable).toBe(false)
    expect(snapshots[0].isSystem).toBe(true)

    expect(snapshots[1].name).toBe('com.apple.TimeMachine.2025-01-15-103000.local')
    expect(snapshots[1].uuid).toBe('03A9C2DB-E5EE-4A95-B393-3048E1CFD44F')
    expect(snapshots[1].purgeable).toBe(true)
    expect(snapshots[1].isSystem).toBe(false)

    expect(snapshots[2].name).toBe('com.apple.os.update-MSUPrepareUpdate')
    expect(snapshots[2].uuid).toBe('C1B5256B-980A-422C-BAE0-03C2E408212A')
    expect(snapshots[2].purgeable).toBe(false)
    expect(snapshots[2].isSystem).toBe(true)
  })

  it('handles empty snapshots plist', () => {
    const emptyPlist = readFixture('diskutil_snapshots_empty.plist')
    const snapshots = parseApfsSnapshots(emptyPlist)
    expect(snapshots).toEqual([])
  })

  it('handles empty snapshots plain text', () => {
    const emptyText = readFixture('diskutil_snapshots_empty.txt')
    const snapshots = parseApfsSnapshots(emptyText)
    expect(snapshots).toEqual([])
  })

  it('returns empty array on malformed or garbage input', () => {
    const malformed = readFixture('malformed.txt')
    expect(parseApfsSnapshots(malformed)).toEqual([])
    expect(parseApfsSnapshots('')).toEqual([])
    expect(parseApfsSnapshots('<<<invalid xml>>>')).toEqual([])
  })
})

describe('parseApfsContainers', () => {
  it('parses APFS container list from plist', () => {
    const plistContent = readFixture('diskutil_apfs_list.plist')
    const container = parseApfsContainers(plistContent)

    expect(container).not.toBeNull()
    expect(container?.containerSize).toBe(1995218165760)
    expect(container?.containerFree).toBe(1060257652736)
    expect(container?.volumes).toHaveLength(5)

    const systemVol = container?.volumes.find((v) => v.role === 'System')
    expect(systemVol).toBeDefined()
    expect(systemVol?.name).toBe('Macintosh HD')
    expect(systemVol?.usedBytes).toBe(18459258880)

    const dataVol = container?.volumes.find((v) => v.role === 'Data')
    expect(dataVol).toBeDefined()
    expect(dataVol?.name).toBe('Data')
    expect(dataVol?.usedBytes).toBe(889361747968)
  })

  it('parses APFS container list from plain text fallback', () => {
    const textContent = readFixture('diskutil_apfs_list.txt')
    const container = parseApfsContainers(textContent)

    expect(container).not.toBeNull()
    expect(container?.containerSize).toBe(1995218165760)
    expect(container?.containerFree).toBe(1060154761216)
    expect(container?.volumes.length).toBeGreaterThanOrEqual(2)

    const systemVol = container?.volumes.find((v) => v.role === 'System')
    expect(systemVol).toBeDefined()
    expect(systemVol?.name).toBe('Macintosh HD')
    expect(systemVol?.usedBytes).toBe(18459258880)

    const dataVol = container?.volumes.find((v) => v.role === 'Data')
    expect(dataVol).toBeDefined()
    expect(dataVol?.name).toBe('Data')
    expect(dataVol?.usedBytes).toBe(889464639488)
  })

  it('handles malformed or empty container output gracefully', () => {
    const malformed = readFixture('malformed.txt')
    expect(parseApfsContainers(malformed)).toBeNull()
    expect(parseApfsContainers('')).toBeNull()
  })
})
