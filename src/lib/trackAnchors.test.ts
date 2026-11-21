import { describe, expect, it } from 'vitest'
import type { StationDepthsFile } from '../data/stationSchema'
import { toGround } from './projection'
import { buildPolyline } from './realtime/polyline'
import { profileRuns, type AnchorShape } from './trackAnchors'

const anchor = { lat: 40.72, lon: -73.95 }
const g = toGround(anchor)
/** A 2 km east-west line through the anchor, `offsetM` south of it. */
const line = (offsetM: number) =>
  buildPolyline([
    { x: g.x - 1000, z: g.z + offsetM },
    { x: g.x + 1000, z: g.z + offsetM },
  ])
const shape = (over: Partial<AnchorShape> = {}): AnchorShape => ({ id: 'L..N', routeId: 'L', direction: 'N', line: line(1), ...over })
const depths: StationDepthsFile = {
  license: 'ODbL-1.0',
  attribution: [],
  // A 170 m track along the line's direction, ends given west then east.
  stations: [{ stationId: 'L08', anchor, tracks: [{ stopId: 'L08N', railY: -10.2, ends: [[-85, 0], [85, 0]] }] }],
}
const stations = [{ id: 'L08', routeIds: ['L'] }]

describe('profileRuns', () => {
  it('anchors a shape running 1 m beside the track to its two projected ends', () => {
    const { runs, unmatched } = profileRuns(depths, stations, [shape()])
    expect(unmatched).toEqual([])
    const [run] = runs.get('L..N')!
    expect(run!.d0).toBeCloseTo(915, 9)
    expect(run!.d1).toBeCloseTo(1085, 9)
    expect(run!.yReal).toBe(-10.2)
  })

  it('orders the run even when the shape runs against the authored direction', () => {
    const reversed = buildPolyline([...line(-1).points].reverse())
    const [run] = profileRuns(depths, stations, [shape({ line: reversed })]).runs.get('L..N')!
    expect(run!.d0).toBeCloseTo(915, 9)
    expect(run!.d1).toBeCloseTo(1085, 9)
  })

  it.each([
    ['the other direction', shape({ direction: 'S' }), stations],
    ['a route that does not serve the station', shape({ routeId: 'G' }), stations],
    ['a station with no routes listed', shape(), []],
    ['a line 20 m off the track', shape({ line: line(20) }), stations],
  ])('leaves the track unmatched for %s', (_, s, st) => {
    const { runs, unmatched } = profileRuns(depths, st, [s])
    expect(runs.size).toBe(0)
    expect(unmatched).toEqual(['L08N'])
  })
})
