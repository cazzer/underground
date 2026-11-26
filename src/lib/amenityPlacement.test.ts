import { describe, expect, it } from 'vitest'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import { amenityMarks, BEARINGS, clearBearing, hullReach, markCentre, plateReach, segmentDistance, squareDistance, trackSegments, type PlateProbe } from './amenityPlacement'
import type { Footprint } from './interiorFootprint'

const O = { x: 1000, z: 2000 }
const line = (x0: number, z0: number, x1: number, z1: number) => ({ points: [{ x: O.x + x0, z: O.z + z0 }, { x: O.x + x1, z: O.z + z1 }] })
const N = BEARINGS[0]!
/** Two plates of half 4 m at 11 and 20 m out, roughly a pair at a 500 m view. */
const PROBES: PlateProbe[] = [{ along: 11, half: 4 }, { along: 20, half: 4 }]
const probes = (count: number) => PROBES.slice(0, count)
const fixed = () => PROBES

describe('segmentDistance', () => {
  it('is 0 for crossing segments and the nearest end otherwise', () => {
    expect(segmentDistance(-1, 0, 1, 0, 0, -1, 0, 1)).toBe(0)
    expect(segmentDistance(0, 0, 1, 0, 3, -1, 3, 1)).toBeCloseTo(2)
    expect(segmentDistance(0, 0, 0, 5, 2, 2, 2, 3)).toBeCloseTo(2)
  })

  it('measures a segment against a square, 0 inside or across it', () => {
    expect(squareDistance(-1, -1, 1, 1, 0, 0, 2)).toBe(0)
    expect(squareDistance(-10, 0, 10, 0, 0, 0, 2)).toBe(0)
    expect(squareDistance(5, -10, 5, 10, 0, 0, 2)).toBeCloseTo(3)
  })
})

describe('clearBearing', () => {
  it('prefers north with nothing near', () => {
    expect(clearBearing(O, trackSegments([line(500, 500, 600, 600)]), [], fixed)).toEqual(N)
  })

  it('turns east off a north-south track pair', () => {
    const segs = trackSegments([line(-4.7, -300, -4.7, 300), line(4.7, 300, 4.7, -300)])
    expect(clearBearing(O, segs, [], fixed)).toEqual({ x: 1, z: 0 })
  })

  it('keeps north beside an east-west track', () => {
    const segs = trackSegments([line(-300, 4.7, 300, 4.7), line(300, -4.7, -300, -4.7)])
    expect(clearBearing(O, segs, [], fixed)).toEqual(N)
  })

  it('dodges another station marker to the north', () => {
    const segs = trackSegments([line(-300, 4.7, 300, 4.7)])
    const got = clearBearing(O, segs, [{ x: O.x, z: O.z - 25 }], fixed)
    expect(got).not.toEqual(N)
    expect(got.z).toBeLessThan(0)
  })

  it('counts a shape with the same ground path once', () => {
    const a = line(-4.7, -300, -4.7, 300)
    expect(trackSegments([a, { points: [...a.points] }]).length).toBe(4)
  })
})

describe('amenityMarks', () => {
  const file = (stations: AmenitiesFile['stations']): AmenitiesFile => ({
    format: 1,
    attribution: '',
    restroomsUpdatedAt: '',
    restroomsMonth: '',
    cscRetrievedAt: '',
    stations,
  })
  const a = { id: 'A', pos: O, memberIds: ['A', 'B'] }
  const c = { id: 'C', pos: { x: O.x + 500, z: O.z }, memberIds: ['C'] }
  const stations = [a, { id: 'B', pos: { x: O.x, z: O.z - 20 }, memberIds: ['B'] }, c]

  it('unions a complex members kinds in order, one row per group, and skips unlisted groups', () => {
    const marks = amenityMarks([a, c], file({ B: { csc: { entrance: 'x' } }, A: { restrooms: 2 } }), new Float32Array(0), stations, probes)
    expect(marks.map((m) => [m.stationId, m.kind, m.k])).toEqual([
      ['A', 'restroom', 0],
      ['A', 'csc', 1],
    ])
    // Its own member B (20 m north) doesn't push the row off north.
    expect(marks[0]!.dir).toEqual(N)
  })

  it('draws nothing for a restroom count of 0', () => {
    expect(amenityMarks([c], file({ C: { restrooms: 0 } }), new Float32Array(0), stations, probes)).toEqual([])
  })
})

describe('hullReach and markCentre', () => {
  const fp: Footprint = { originX: O.x + 10, originZ: O.z, hull: [[-5, -20], [5, -20], [5, 20], [-5, 20]], yLow: -10, yHigh: 0 }

  it('measures the hull along a bearing from the station point', () => {
    expect(hullReach(fp, O, N)).toBeCloseTo(20)
    expect(hullReach(fp, O, { x: 1, z: 0 })).toBeCloseTo(15)
    expect(hullReach(fp, O, { x: -1, z: 0 })).toBeCloseTo(-5)
  })

  it('reaches a yawed plate farther along a diagonal', () => {
    expect(plateReach(2, N, 0)).toBeCloseTo(2)
    expect(plateReach(2, BEARINGS[1]!, 0)).toBeCloseTo(2 * Math.SQRT2)
    expect(plateReach(2, BEARINGS[1]!, Math.PI / 4)).toBeCloseTo(2)
  })

  it('rows the plates one gap apart past the clearance', () => {
    expect(markCentre(0, 6, 4, 1)).toBe(11)
    expect(markCentre(1, 6, 4, 1)).toBe(20)
  })
})
