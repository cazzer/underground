import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeStationDepths, type DepthsStation } from '../../src/data/depthsCodec.ts'
import type { ShapesFile, StationsFile } from '../../src/data/schema.ts'
import type { PackedDepthsFile, StationDepthsFile, StationInterior, TrackDepth } from '../../src/data/stationSchema.ts'
import { toGround } from '../../src/lib/projection.ts'
import { buildPolyline } from '../../src/lib/realtime/polyline.ts'
import { profileRuns, type AnchorShape } from '../../src/lib/trackAnchors.ts'
import { TRACK_OFFSET_M } from '../../src/lib/trackOffset.ts'
import { buildTrackProfile, GRADE } from '../../src/lib/trackProfile.ts'
import { drawnLines, PACK_TOL_M, packStationDepths, renderPackedDepths } from './depthsPack.ts'
import { buildStationDepths } from './stationDepths.ts'
import { NOT_INTERIOR_FILES } from './stationIndex.ts'

describe('packStationDepths', () => {
  const anchor = { lat: 40.72, lon: -73.95 }
  const g = toGround(anchor)
  const shapes: AnchorShape[] = [
    { id: 'L..N', routeId: 'L', direction: 'N', line: buildPolyline([{ x: g.x - 1000, z: g.z + 2 }, { x: g.x + 1000, z: g.z + 2 }]) },
    { id: 'L..S', routeId: 'L', direction: 'S', line: buildPolyline([{ x: g.x + 1000, z: g.z - 2 }, { x: g.x - 1000, z: g.z - 2 }]) },
  ]
  const stations: DepthsStation[] = [{ id: 'L08', ...anchor, stops: ['L08N', 'L08S'], routes: ['L'] }]
  const track = (stopId: string, x0: number, x1: number, z: number, railY = -10.2): TrackDepth => ({ stopId, railY, ends: [[x0, z], [x1, z]] })
  const full = (...tracks: TrackDepth[]): StationDepthsFile => ({ license: 'ODbL-1.0', attribution: ['OSM'], stations: [{ stationId: 'L08', anchor, tracks }] })
  const roundTrip = (depths: StationDepthsFile) => {
    const packed = packStationDepths(depths, stations, shapes)
    const want = profileRuns(depths, [{ id: 'L08', routeIds: ['L'] }], shapes).runs
    const got = profileRuns(decodeStationDepths(packed.file, stations, shapes).depths, [{ id: 'L08', routeIds: ['L'] }], shapes).runs
    for (const [id, [run]] of want) {
      const [back] = got.get(id)!
      expect(Math.abs(back!.d0 - run!.d0), id).toBeLessThanOrEqual(PACK_TOL_M)
      expect(Math.abs(back!.d1 - run!.d1), id).toBeLessThanOrEqual(PACK_TOL_M)
      expect(back!.yReal).toBeCloseTo(run!.yReal, 6)
    }
    return packed
  }

  it('packs mirrored tracks into one column with da and dh at 0', () => {
    const { file, split, notRidden } = roundTrip(full(track('L08N', -70, 90, 3), track('L08S', 90, -70, -3)))
    expect([file.station, file.y, file.a, file.h, file.da, file.dh]).toEqual([[0], [-102], [10], [80], [0], [0]])
    expect(file.tracks).toEqual({})
    expect([split, notRidden]).toEqual([[], []])
  })

  it('gives a staggered or longer S track its da and dh', () => {
    const { file, split } = roundTrip(full(track('L08N', -70, 90, 3), track('L08S', 120, -60, -3)))
    expect([file.da, file.dh, split]).toEqual([[-20], [10], []])
  })

  it('overrides a track at another height, and packs a track no line rides as null', () => {
    const { file, split } = roundTrip(full(track('L08N', -70, 90, 3), track('L08S', 90, -70, -3, -5.6)))
    expect(file.tracks).toEqual({ L08S: [-56, 10, -2, 80] })
    expect(split).toEqual(['L08S'])
    const away = packStationDepths(full(track('L08N', -70, 90, 3), track('L08S', 90, -70, -30)), stations, shapes)
    expect(away.notRidden).toEqual(['L08S'])
    expect(away.file.tracks).toEqual({ L08S: null })
  })

  it('throws on a station missing from stations.json or a track of another station', () => {
    expect(() => packStationDepths({ ...full(), stations: [{ stationId: 'X', anchor, tracks: [] }] }, stations, shapes)).toThrow(/X: has a depth/)
    expect(() => packStationDepths(full(track('A01N', 0, 1, 0)), stations, shapes)).toThrow(/A01N: not a child stop of L08/)
  })
})

describe('the committed station-depths.json', () => {
  const data = new URL('../../public/data/', import.meta.url)
  const json = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))
  const dir = new URL('stations/', data)
  const interiors = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !NOT_INTERIOR_FILES.has(f))
    .map((f) => json(new URL(f, dir)) as StationInterior)
  const stations = (json(new URL('stations.json', data)) as StationsFile).stations
  const lines = drawnLines((json(new URL('shapes.json', data)) as ShapesFile).shapes, TRACK_OFFSET_M)
  const anchorStations = stations.map((s) => ({ id: s.id, routeIds: s.routes }))
  const full = buildStationDepths(interiors)
  const text = readFileSync(new URL('station-depths.json', data), 'utf8')

  it('is fresh: packing every committed interior reproduces it (rerun npm run data:stations if not)', () => {
    expect(interiors.some((i) => i.generated)).toBe(true)
    expect(renderPackedDepths(packStationDepths(full, stations, lines).file)).toBe(text)
  })

  // Equivalence with the per-track format the interiors give: every run profileRuns finds from the full ends is
  // there after decoding, its ends within 3 m and its height within 0.05 m (decimeters, rounded). A decoded track can also pick up a sibling
  // shape the full ends just missed (its ends now lie on a drawn line); those extras must still build cleanly.
  it('decodes to the runs of the full format within 3 m, and every shape still profiles without drops or steep eases', () => {
    const decoded = decodeStationDepths(JSON.parse(text) as PackedDepthsFile, stations, lines)
    expect(decoded.missed).toEqual([])
    const want = profileRuns(full, anchorStations, lines)
    const got = profileRuns(decoded.depths, anchorStations, lines)
    expect(got.unmatched).toEqual([])
    let checked = 0
    for (const [shapeId, runs] of want.runs) {
      for (const run of runs) {
        const back = got.runs.get(shapeId)?.find((r) => r.stationId === run.stationId)
        const label = `${run.stationId} on ${shapeId}`
        expect(back, label).toBeDefined()
        expect(Math.abs(back!.d0 - run.d0), label).toBeLessThanOrEqual(3)
        expect(Math.abs(back!.d1 - run.d1), label).toBeLessThanOrEqual(3)
        expect(Math.abs(back!.yReal - run.yReal), label).toBeLessThanOrEqual(0.05 + 1e-9)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(3000)
    for (const l of lines) {
      const built = buildTrackProfile(got.runs.get(l.id) ?? [], { grade: GRADE, yScale: 2 })
      expect([built.dropped, built.steep], l.id).toEqual([[], []])
    }
  })
})
