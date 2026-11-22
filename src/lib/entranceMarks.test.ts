import { describe, expect, it } from 'vitest'
import type { StationStreets, StreetEntrance } from '../data/streetSchema'
import { entranceMarkBuffers, unmatchedEntrances } from './entranceMarks'

function entrance(x: number, z: number, type = 'Stair'): StreetEntrance {
  return { x, z, type, entry: true, exit: true, stopIds: ['L08'], street: null, wayId: null, cross: null, crossWayId: null, side: null, plaza: null }
}

function file(entrances: StreetEntrance[]): StationStreets {
  return {
    stationId: 'L08',
    anchor: { lat: 40.7173, lon: -73.95687 },
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300,
    walkRadiusM: 150,
    nodeId: [],
    x: [],
    z: [],
    ways: [],
    entrances,
  }
}

describe('unmatchedEntrances', () => {
  // As at Bedford Av: the interior's anchor sits about (-11.80, -10.90) m from the street file's.
  const fileGround = { x: 1000, z: 2000 }
  const origin = { x: 1000 - 11.8, z: 2000 - 10.9 }

  it('matches entrances across offset anchors by scene ground position', () => {
    const streets = file([entrance(-847, -370), entrance(277, 449)])
    // The first is the interior's (-72.94, -26.12): the same ground point to a few cm.
    const interior = { origin, entrances: [{ x: -72.94, z: -26.12, type: 'Stair' }] }
    expect(unmatchedEntrances(streets, fileGround, interior)).toEqual([1])
  })

  it('needs the same type', () => {
    const streets = file([entrance(-847, -370, 'Elevator')])
    const interior = { origin, entrances: [{ x: -72.94, z: -26.12, type: 'Stair' }] }
    expect(unmatchedEntrances(streets, fileGround, interior)).toEqual([0])
  })

  it('matches within 1.5 m, inclusive', () => {
    const streets = file([entrance(15, 0), entrance(16, 0)])
    const interior = { origin: fileGround, entrances: [{ x: 0, z: 0, type: 'Stair' }] }
    expect(unmatchedEntrances(streets, fileGround, interior)).toEqual([1])
  })

  it('keeps every entrance with no interior', () => {
    expect(unmatchedEntrances(file([entrance(0, 0), entrance(50, 50)]), fileGround, null)).toEqual([0, 1])
  })
})

describe('entranceMarkBuffers', () => {
  it('draws a square of four segments at street level around each listed entrance', () => {
    const streets = file([entrance(100, -50), entrance(0, 0)])
    const b = entranceMarkBuffers(streets, [0], 2.5, [0.5, 0.25, 1])
    expect(b.positions).toHaveLength(4 * 6)
    const xs = new Set<number>()
    const zs = new Set<number>()
    for (let i = 0; i < b.positions.length; i += 3) {
      xs.add(b.positions[i]!)
      expect(b.positions[i + 1]).toBe(0)
      zs.add(b.positions[i + 2]!)
    }
    expect([...xs].sort((a, b) => a - b)).toEqual([8.75, 11.25])
    expect([...zs].sort((a, b) => a - b)).toEqual([-6.25, -3.75])
    expect([...b.colors.slice(0, 3)]).toEqual([0.5, 0.25, 1])
  })
})
