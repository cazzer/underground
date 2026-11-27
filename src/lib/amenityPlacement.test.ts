import { describe, expect, it } from 'vitest'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import { plateProbes } from '../scene/amenitySizes'
import { amenityMarks, bandReach, BEARINGS, clearBearing, hullReach, plateReach, rowCentreInto, segmentDistance, squareDistance } from './amenityPlacement'
import type { Footprint } from './interiorFootprint'
import { segmentsNear, trackGrid } from './trackGrid'

const O = { x: 1000, z: 2000 }
const line = (x0: number, z0: number, x1: number, z1: number) => ({ points: [{ x: O.x + x0, z: O.z + z0 }, { x: O.x + x1, z: O.z + z1 }] })
const N = BEARINGS[0]!
const E = { x: 1, z: 0 }
/** A row of two, as the scene scores one. */
const pair = (dir: { x: number; z: number }) => plateProbes(2, dir)
const probes = plateProbes

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
    expect(clearBearing(O, trackGrid([line(500, 500, 600, 600)]), [], pair)).toEqual(N)
  })

  it('turns east off a north-south track pair', () => {
    const grid = trackGrid([line(-4.7, -300, -4.7, 300), line(4.7, 300, 4.7, -300)])
    expect(clearBearing(O, grid, [], pair)).toEqual(E)
  })

  it('keeps north beside an east-west track', () => {
    const grid = trackGrid([line(-300, 4.7, 300, 4.7), line(300, -4.7, -300, -4.7)])
    expect(clearBearing(O, grid, [], pair)).toEqual(N)
  })

  it('dodges another station marker to the north', () => {
    const grid = trackGrid([line(-300, 4.7, 300, 4.7)])
    expect(clearBearing(O, grid, [], pair)).toEqual(N)
    expect(clearBearing(O, grid, [{ x: O.x, z: O.z - 25 }], pair)).not.toEqual(N)
  })

  it('grids a shape with the same ground path once, and finds a long segment from any cell it crosses', () => {
    const a = line(-4.7, -300, -4.7, 300)
    const grid = trackGrid([a, { points: [...a.points] }])
    expect(grid.segments.length).toBe(4)
    expect(segmentsNear(grid, { x: O.x, z: O.z + 250 }, 10)).toEqual([-4.7, -550, -4.7, 50].map((v) => expect.closeTo(v, 3)))
    expect(segmentsNear(grid, { x: O.x + 500, z: O.z }, 80)).toEqual([])
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
    const marks = amenityMarks([a, c], file({ B: { csc: { entrance: 'x' } }, A: { restrooms: 2 } }), trackGrid([]), stations, probes)
    expect(marks.map((m) => [m.stationId, m.kind, m.k, m.n])).toEqual([
      ['A', 'restroom', 0, 2],
      ['A', 'csc', 1, 2],
    ])
    // Its own member B (20 m north) doesn't push the row off north.
    expect(marks[0]!.dir).toEqual(N)
  })

  it('draws nothing for a restroom count of 0', () => {
    expect(amenityMarks([c], file({ C: { restrooms: 0 } }), trackGrid([]), stations, probes)).toEqual([])
  })
})

describe('hullReach, plateReach and the row', () => {
  const fp: Footprint = { originX: O.x + 10, originZ: O.z, hull: [[-5, -20], [5, -20], [5, 20], [-5, 20]], yLow: -10, yHigh: 0 }

  it('measures the hull along a bearing from the station point', () => {
    expect(hullReach(fp, O, N)).toBeCloseTo(20)
    expect(hullReach(fp, O, E)).toBeCloseTo(15)
    expect(hullReach(fp, O, { x: -1, z: 0 })).toBeCloseTo(-5)
  })

  it('measures the hull within a lateral band, into a corner', () => {
    // An L: 40 m north-south on the west, 40 m east-west on the south; north of the origin's east side is open.
    const ell: Footprint = { originX: O.x, originZ: O.z, hull: [[-20, 20], [20, 20], [20, 10], [-10, -20], [-20, -20]], yLow: 0, yHigh: 0 }
    expect(bandReach(ell, O, N, -25, 25)).toBeCloseTo(20)
    // Within x 10..15 only the slanted edge reaches north: from z 10 at x 20 to z -20 at x -10, so z 0..5 there.
    expect(bandReach(ell, O, N, 10, 15)).toBeCloseTo(0)
    expect(bandReach(ell, O, N, 30, 40)).toBe(-Infinity)
  })

  it('reaches a yawed plate farther along a diagonal', () => {
    expect(plateReach(2, N, 0)).toBeCloseTo(2)
    expect(plateReach(2, BEARINGS[1]!, 0)).toBeCloseTo(2 * Math.SQRT2)
    expect(plateReach(2, BEARINGS[1]!, Math.PI / 4)).toBeCloseTo(2)
  })

  const at = (k: number, dir: { x: number; z: number }, az: number) => rowCentreInto({ x: 0, z: 0 }, k, 2, { x: 0, z: 0 }, dir, 6, 4, 1, az)

  it('runs a row across the screen, centred above a north bearing, in order left to right', () => {
    // Plates 8 m wide one 1 m gap apart, 6 + 1 + 4 m north of the marker, either side of it.
    expect(at(0, N, 0)).toEqual({ x: expect.closeTo(-4.5), z: expect.closeTo(-11) })
    expect(at(1, N, 0)).toEqual({ x: expect.closeTo(4.5), z: expect.closeTo(-11) })
  })

  it('starts a row on a bearing pointing right and ends it on one pointing left, never nearer the marker', () => {
    expect(at(0, E, 0)).toEqual({ x: expect.closeTo(11), z: expect.closeTo(0) })
    expect(at(1, E, 0).x).toBeCloseTo(20)
    expect(at(1, { x: -1, z: 0 }, 0).x).toBeCloseTo(-11)
    expect(at(0, { x: -1, z: 0 }, 0).x).toBeCloseTo(-20)
    // Turned half way round, the screen's right is west: the same east bearing now ends the row.
    expect(at(1, E, Math.PI).x).toBeCloseTo(11)
    for (const dir of BEARINGS) {
      for (const az of [0, 0.7, 2, -2.5]) {
        for (const k of [0, 1]) {
          const c = at(k, dir, az)
          expect(c.x * dir.x + c.z * dir.z).toBeGreaterThanOrEqual(6 + 1 + plateReach(4, dir, az) - 1e-9)
        }
      }
    }
  })
})
