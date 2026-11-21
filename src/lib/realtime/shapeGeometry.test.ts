import { describe, expect, it } from 'vitest'
import { E5, deltaEncode } from '../../data/codec'
import type { Shape, StationsFile, TripIndexFile } from '../../data/schema'
import { toGround } from '../projection'
import { geometries, index, shapes, stations } from './fixture'
import { buildShapeGeometries } from './shapeGeometry'

describe('buildShapeGeometries', () => {
  it('places fixture stops at their distances along the shape', () => {
    const g = geometries.get('1..N03R')!
    const z = (id: string) => toGround(stations.stations.find((s) => s.id === id)!).z
    expect(g.stops).toEqual(['101N', '102N', '103N'])
    expect(g.stopDistances[0]).toBeCloseTo(0, 0)
    expect(g.stopDistances[1]).toBeCloseTo(z('101') - z('102'), 0)
    expect(g.stopDistances[2]).toBeCloseTo(z('101') - z('103'), 0)
    expect(g.maxStopOffsetM).toBeLessThan(1)
    expect(g.line.length).toBeCloseTo(g.stopDistances[2]!, 0)
  })

  it('keeps distances non-decreasing on a hairpin', () => {
    // Out 0.02 deg north, back down 0.0001 deg east; stop C sits beside stop A but is visited last.
    const pts: [number, number][] = [
      [40.7, -74.0],
      [40.72, -74.0],
      [40.72, -73.9999],
      [40.7, -73.9999],
    ]
    const hairpin: Shape = {
      id: 'H..N01R',
      routeId: 'H',
      direction: 'N',
      primary: true,
      lat: deltaEncode(pts.map(([la]) => Math.round(la * E5))),
      lon: deltaEncode(pts.map(([, lo]) => Math.round(lo * E5))),
    }
    const st: StationsFile = {
      feedVersion: 'x',
      stations: [
        { id: 'A', name: 'A', lat: 40.7, lon: -74.0, stops: ['AN'], routes: [] },
        { id: 'B', name: 'B', lat: 40.72, lon: -74.0, stops: ['BN'], routes: [] },
        { id: 'C', name: 'C', lat: 40.7001, lon: -73.9999, stops: ['CN'], routes: [] },
      ],
    }
    const idx: TripIndexFile = {
      ...index,
      patterns: { 'H..N01R': { routeId: 'H', direction: 'N', stops: ['AN', 'BN', 'CN'] } },
    }
    const g = buildShapeGeometries({ feedVersion: shapes.feedVersion, shapes: [hairpin] }, idx, st).get('H..N01R')!
    expect(g.stopDistances[0]).toBeLessThan(g.stopDistances[1]!)
    expect(g.stopDistances[1]).toBeLessThanOrEqual(g.stopDistances[2]!)
    expect(g.stopDistances[2]!).toBeGreaterThan(g.line.length * 0.9)
  })

  it('throws naming a stop with no station', () => {
    const idx: TripIndexFile = {
      ...index,
      patterns: { '1..N03R': { routeId: '1', direction: 'N', stops: ['101N', 'Z99N'] } },
    }
    expect(() => buildShapeGeometries(shapes, idx, stations)).toThrow(/Z99N/)
  })

  it('throws when a pattern has no shape', () => {
    expect(() => buildShapeGeometries({ feedVersion: 'x', shapes: [] }, index, stations)).toThrow(/no shape/)
  })
})
