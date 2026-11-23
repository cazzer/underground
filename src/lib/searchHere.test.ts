import { describe, expect, it } from 'vitest'
import { placeFix, type LocateState, type MarkedPlacement, type Placement } from './locate'
import type { Bounds } from './network'
import { toGround, toLatLon } from './projection'
import { realGroupById, realGroups, realStations } from './realGroups.testdata'
import { fixDistanceOf, hereRow, hereStatus, searchStatusText } from './searchHere'
import { SEARCH_LIMIT } from './stationSearch'

const bounds: Bounds = { minX: -30000, maxX: 30000, minZ: -40000, maxZ: 30000 }
const place = (lat: number, lon: number, accuracyM = 30): Placement => {
  const p = placeFix({ lat, lon, accuracyM }, realStations, realGroupById, bounds)
  if (!p) throw new Error('no placement')
  return p
}
const marked = (lat: number, lon: number, accuracyM?: number): MarkedPlacement => {
  const p = place(lat, lon, accuracyM)
  if (p.kind === 'outside') throw new Error('fixture fix is not marked')
  return p
}
const UNION_SQ = { lat: 40.7347, lon: -73.9906 }

describe('hereRow', () => {
  it('has no row with no fix', () => {
    expect(hereRow(null)).toBeNull()
  })

  it('names the nearest station and the distance', () => {
    const fix = marked(UNION_SQ.lat, UNION_SQ.lon)
    const row = hereRow(fix)!
    expect(row.nearestId).toBe(fix.nearest.id)
    expect(row.title).toBe('My location')
    expect(row.detail).toMatch(/^Nearest station .+ · about \d+ m$/)
    expect(row.detail).toContain(fix.nearest.name)
    expect(row.spoken).toMatch(/^My location, nearest station .+, about \d+ m$/)
  })

  it('says approximate for a coarse fix, not for a precise one', () => {
    const coarse = hereRow(marked(UNION_SQ.lat, UNION_SQ.lon, 900))!
    expect(coarse.detail.endsWith(' · approximate')).toBe(true)
    expect(coarse.spoken.endsWith(', approximate')).toBe(true)
    expect(hereRow(marked(UNION_SQ.lat, UNION_SQ.lon, 20))!.detail).not.toContain('approximate')
  })

  it('reads a far fix in kilometers', () => {
    const far = place(40.59, -73.89)
    if (far.kind !== 'far') throw new Error(`fixture fix is ${far.kind}`)
    expect(hereRow(far)!.detail).toMatch(/about \d+(\.\d)? km/)
  })

  it('names a complex by its group, whichever member is nearest', () => {
    const times = realGroups.find((g) => g.name === 'Times Sq-42 St')!
    const member = realStations.find((s) => s.id === times.memberIds[times.memberIds.length - 1])!
    const row = hereRow(marked(toLatLon(member.pos).lat, toLatLon(member.pos).lon))!
    expect(row.nearestId).toBe(times.id)
    expect(row.detail).toContain(times.name)
  })
})

describe('hereStatus', () => {
  const near = marked(UNION_SQ.lat, UNION_SQ.lon)
  const outside = place(41.5, -72.5)
  const cases: [string, LocateState][] = [
    ['idle', { status: 'idle' }],
    ['locating', { status: 'locating', previous: null }],
    ['denied', { status: 'failed', reason: 'denied', previous: null }],
    ['unsupported', { status: 'failed', reason: 'unsupported', previous: null }],
    ['outside', { status: 'located', placement: outside }],
    ['found', { status: 'located', placement: near }],
  ]
  const by = Object.fromEntries(cases.map(([k, s]) => [k, hereStatus(s)]))

  it('says nothing when idle', () => {
    expect(by.idle).toEqual({ spoken: '', visible: null })
  })
  it('says it is looking, in the header words', () => {
    expect(by.locating).toEqual({ spoken: 'Finding your location…', visible: { text: 'Finding your location…', tone: 'info' } })
  })
  it('says why a request failed, in the header words', () => {
    expect(by.denied!.visible).toEqual({ text: by.denied!.spoken, tone: 'warn' })
    expect(by.denied!.spoken).toContain('Location is blocked')
    expect(by.unsupported!.spoken).toBe("This browser can't share your location.")
  })
  it('says an outside fix is outside, with no row to point at', () => {
    expect(outside.kind).toBe('outside')
    expect(by.outside!.spoken).toBe("You're outside the area this map covers.")
    expect(by.outside!.visible?.tone).toBe('warn')
  })
  it('points at the row on success and shows nothing extra', () => {
    expect(by.found!.spoken).toBe(`Found your location. My location, nearest station ${near.nearest.name}, is below.`)
    expect(by.found!.visible).toBeNull()
  })
  it('keeps the failure words while a good fix is kept', () => {
    expect(hereStatus({ status: 'failed', reason: 'timeout', previous: near }).spoken).toContain('took too long')
  })
})

describe('searchStatusText', () => {
  it('keeps the station count words', () => {
    expect(searchStatusText(false, 5)).toBe('')
    expect(searchStatusText(true, 0)).toBe('No stations match')
    expect(searchStatusText(true, SEARCH_LIMIT)).toBe(`Top ${SEARCH_LIMIT} stations`)
    expect(searchStatusText(true, 1)).toBe('1 station')
    expect(searchStatusText(true, 7)).toBe('7 stations')
  })
})

describe('fixDistanceOf', () => {
  const stationById = new Map(realStations.map((s) => [s.id, s]))
  const group = realGroups[0]!

  it('is the distance to the nearest member', () => {
    const at = toGround({ lat: 40.7, lon: -74.0 })
    const expected = Math.min(...group.memberIds.map((id) => Math.hypot(stationById.get(id)!.pos.x - at.x, stationById.get(id)!.pos.z - at.z)))
    expect(fixDistanceOf(at, stationById)(group)).toBeCloseTo(expected, 6)
  })

  it('throws on a member the network lacks', () => {
    expect(() => fixDistanceOf({ x: 0, z: 0 }, new Map())(group)).toThrow(/lacks/)
  })
})
