import { describe, expect, it } from 'vitest'
import type { StationStreets, StreetEntrance, StreetWay } from '../data/streetSchema'
import { toGround, toLatLon, type LatLon } from './projection'
import { mergeComplexStreets, streetFileIds } from './streetMerge'

/** An entrance at (x, z) meters from its file's anchor. */
function entrance(x: number, z: number, type = 'Stair', street: string | null = null): StreetEntrance {
  return { x: x * 10, z: z * 10, type, entry: true, exit: true, stopIds: ['A'], street, wayId: null, cross: null, crossWayId: null, side: null, plaza: null }
}

/** A file anchored at `anchor` with a way named `wayName` from (0, 0) to (0, 50) m when given. */
function file(id: string, anchor: LatLon, entrances: StreetEntrance[], wayName: string | null = null): StationStreets {
  const ways: StreetWay[] = wayName === null ? [] : [{ id: 1, highway: 'primary', name: wayName, oneway: 0, nodes: [0, 1] }]
  return {
    stationId: id,
    anchor,
    format: 1,
    license: 'ODbL-1.0',
    attribution: [],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300,
    walkRadiusM: 150,
    nodeId: [1, 2],
    x: [0, 0],
    z: [0, 500],
    ways,
    entrances,
  }
}

const LEAD_AT: LatLon = { lat: 40.758, lon: -73.9855 }
/** A point that lies (east, south) meters from `from` on the scene ground. */
function offsetBy(from: LatLon, east: number, south: number): LatLon {
  const g = toGround(from)
  return toLatLon({ x: g.x + east, z: g.z + south })
}

describe('streetFileIds', () => {
  it('reads every member for a complex lead, lead first', () => {
    expect(streetFileIds('L', ['L', 'A', 'B'])).toEqual(['L', 'A', 'B'])
  })
  it('reads only its own file for a non-lead member, a lone station and an unknown id', () => {
    expect(streetFileIds('A', ['L', 'A', 'B'])).toEqual(['A'])
    expect(streetFileIds('X', ['X'])).toEqual(['X'])
    expect(streetFileIds('Q', [])).toEqual(['Q'])
  })
})

describe('mergeComplexStreets', () => {
  const lead = file('L', LEAD_AT, [entrance(10, 10), entrance(-20, 5, 'Elevator')], 'Broadway')

  it('drops a member entrance of the same type within 1.5 m of a lead entrance, keeps others', () => {
    // The member's anchor is 100 m east, so its entrance at (-90, 10) is the lead's (10, 10) on the ground.
    const member = file('A', offsetBy(LEAD_AT, 100, 0), [
      entrance(-90, 10),
      entrance(-90, 10, 'Elevator'),
      entrance(-90 + 1.4, 10 + 0.1, 'Stair'),
      entrance(-90, 11.6),
      entrance(-90, 8.4),
    ])
    const { file: merged } = mergeComplexStreets(lead, [member])
    // Kept: the same point as another type, and the two 1.6 m away (the 1.4 m one matches), nearest the lead first.
    expect(merged.entrances.slice(2).map((e) => [e.type, e.z])).toEqual([
      ['Stair', 84],
      ['Elevator', 100],
      ['Stair', 116],
    ])
  })

  it('moves an added entrance into the lead’s decimeter frame', () => {
    const anchor = offsetBy(LEAD_AT, 223.4, -118.7)
    const member = file('A', anchor, [entrance(12.3, -4.5, 'Stair', 'W 42 St')])
    const { file: merged } = mergeComplexStreets(lead, [member])
    const added = merged.entrances[2]!
    const [m, l] = [toGround(anchor), toGround(LEAD_AT)]
    expect(Math.abs(added.x - ((m.x - l.x) * 10 + 123))).toBeLessThanOrEqual(0.5)
    expect(Math.abs(added.z - ((m.z - l.z) * 10 - 45))).toBeLessThanOrEqual(0.5)
    expect(Number.isInteger(added.x) && Number.isInteger(added.z)).toBe(true)
    // The join fields are the member file's own.
    expect(added.street).toBe('W 42 St')
    expect(added.stopIds).toEqual(['A'])
  })

  it('keeps one file’s close entrances, drops a later member’s match of an earlier member’s, leads with the lead’s', () => {
    const at1 = offsetBy(LEAD_AT, 200, 0)
    const at2 = offsetBy(LEAD_AT, 0, 200)
    const m1 = file('A', at1, [entrance(0, 0), entrance(1, 0)])
    // m2's entrance at (200, -200) from its anchor is on m1's first one's ground point.
    const m2 = file('B', at2, [entrance(200, -200), entrance(0, 5)])
    const { file: merged } = mergeComplexStreets(lead, [m1, m2])
    expect(merged.entrances.slice(0, 2)).toEqual(lead.entrances)
    expect(merged.entrances).toHaveLength(2 + 2 + 1)
    expect(merged.ways).toBe(lead.ways)
    expect(merged.x).toBe(lead.x)
    expect(merged.anchor).toBe(lead.anchor)
  })

  it('orders the added entrances nearest the lead first, a tie keeping member then file order', () => {
    const m1 = file('A', offsetBy(LEAD_AT, 0, 0), [entrance(0, 150, 'Stair', 'a'), entrance(0, 80, 'Stair', 'b')])
    const m2 = file('B', offsetBy(LEAD_AT, 0, 0), [entrance(100, 0, 'Stair', 'c'), entrance(-100, 0, 'Stair', 'd'), entrance(30, 0, 'Stair', 'e')])
    const { file: merged } = mergeComplexStreets(lead, [m1, m2])
    expect(merged.entrances.slice(0, 2)).toEqual(lead.entrances)
    expect(merged.entrances.slice(2).map((e) => e.street)).toEqual(['e', 'b', 'c', 'd', 'a'])
  })

  it('lists each member’s named streets shifted by its anchor offset, in meters', () => {
    const member = file('A', offsetBy(LEAD_AT, 40, -25), [], 'W 43 St')
    const { extraLines } = mergeComplexStreets(lead, [member])
    expect(extraLines).toHaveLength(1)
    const [a, b] = extraLines[0]!.points
    const m = toGround(member.anchor)
    const l = toGround(LEAD_AT)
    expect(extraLines[0]!.name).toBe('W 43 St')
    expect(a![0]).toBeCloseTo(m.x - l.x, 6)
    expect(a![1]).toBeCloseTo(m.z - l.z, 6)
    expect(b![1]).toBeCloseTo(m.z - l.z + 50, 6)
  })

  it('adds nothing when no member has a file', () => {
    const { file: merged, extraLines } = mergeComplexStreets(lead, [])
    expect(merged.entrances).toEqual(lead.entrances)
    expect(extraLines).toEqual([])
  })
})
