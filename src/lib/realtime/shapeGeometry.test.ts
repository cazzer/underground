import { describe, expect, it } from 'vitest'
import { E5, deltaEncode } from '../../data/codec'
import type { Shape, StationsFile, TripIndexFile } from '../../data/schema'
import { toGround } from '../projection'
import { trackLine } from '../trackLine'
import { TRACK_OFFSET_M } from '../trackOffset'
import { geometries, index, shapes, stations } from './fixture'
import { projectForward } from './polyline'
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

  it('runs on the offset track line the map draws, with the stops projected onto it', () => {
    const shape = shapes.shapes.find((s) => s.id === '1..N03R')!
    const g = buildShapeGeometries(shapes, index, stations, TRACK_OFFSET_M).get('1..N03R')!
    const centered = geometries.get('1..N03R')!
    expect(g.line.points).toEqual(trackLine(shape, TRACK_OFFSET_M))
    // A straight shape: the track is beside it, so each stop is just as far along and 4.7 m to the side.
    expect(g.stopDistances.length).toBe(centered.stopDistances.length)
    g.stopDistances.forEach((d, i) => expect(Math.abs(d - centered.stopDistances[i]!), `stop ${i}`).toBeLessThan(0.1))
    expect(g.maxStopOffsetM).toBeCloseTo(TRACK_OFFSET_M, 1)
  })

  // At offset 0: the legs are 8.4 m apart, closer than two offsets, so offset legs would cross.
  it('keeps distances non-decreasing on a hairpin, honoring the forward-only cursor', () => {
    // Out 0.02 deg north along lon -74.0, back down along lon -73.9999. Stop C is visited last but sits
    // on the outbound leg next to A, so a global nearest-point projection would put it near distance 0.
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
        { id: 'C', name: 'C', lat: 40.7001, lon: -74.0, stops: ['CN'], routes: [] },
      ],
    }
    const idx: TripIndexFile = {
      ...index,
      patterns: { 'H..N01R': { routeId: 'H', direction: 'N', stops: ['AN', 'BN', 'CN'] } },
    }
    const g = buildShapeGeometries({ feedVersion: shapes.feedVersion, shapes: [hairpin] }, idx, st, 0).get('H..N01R')!

    const globalC = projectForward(g.line, toGround(st.stations[2]!), { segment: 0, t: 0 })
    expect(globalC.distance).toBeLessThan(50) // what an unconstrained projection would choose

    expect(g.stopDistances[0]).toBeLessThan(g.stopDistances[1]!)
    expect(g.stopDistances[1]).toBeLessThanOrEqual(g.stopDistances[2]!)
    // On the return leg, about 11 m (0.0001 deg) before the end of the line.
    expect(g.line.length - g.stopDistances[2]!).toBeGreaterThan(5)
    expect(g.line.length - g.stopDistances[2]!).toBeLessThan(20)
  })

  it('throws naming a stop with no station', () => {
    const idx: TripIndexFile = {
      ...index,
      patterns: { '1..N03R': { routeId: '1', direction: 'N', stops: ['101N', 'Z99N'] } },
    }
    expect(() => buildShapeGeometries(shapes, idx, stations, 0)).toThrow(/Z99N/)
  })

  it('throws when a pattern has no shape', () => {
    expect(() => buildShapeGeometries({ feedVersion: 'x', shapes: [] }, index, stations, 0)).toThrow(/no shape/)
  })
})
