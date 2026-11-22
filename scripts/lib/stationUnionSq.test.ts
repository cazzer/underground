/**
 * The committed 14 St-Union Sq complex (public/data/stations/635.json, members 635, L03 and R20) against its intent:
 * five OSM platforms with one track per stop, the L to Broadway stairs, the index aliases, and depths for every member
 * that the map's lines ride. Its step-free routes are checked in src/lib/interiorGraph.data.test.ts (interiorGraph.ts
 * has extensionless imports, which the scripts' nodenext can't load).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeStationDepths } from '../../src/data/depthsCodec.ts'
import type { ShapesFile, StationsFile } from '../../src/data/schema.ts'
import type { PackedDepthsFile, StationIndex, StationInterior } from '../../src/data/stationSchema.ts'
import { profileRuns } from '../../src/lib/trackAnchors.ts'
import { TRACK_OFFSET_M } from '../../src/lib/trackOffset.ts'
import { drawnLines } from './depthsPack.ts'

const DATA = new URL('../../public/data/', import.meta.url)
const json = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, DATA), 'utf8')) as T
const interior = json<StationInterior>('stations/635.json')
const MEMBERS = ['635', 'L03', 'R20']

describe('14 St-Union Sq complex', () => {
  it('is one approximate authored file for all three members', () => {
    expect(interior.memberStationIds).toEqual(MEMBERS)
    expect(interior.approximate).toBe(true)
    expect(interior.generated).toBeUndefined()
    expect(interior.slabs.length).toBeGreaterThan(0)
    expect(interior.slabs.every((s) => s.approximate === true)).toBe(true)
  })

  it('has the five OSM platforms, each with its own stops', () => {
    const platforms = Object.fromEntries(interior.platforms.map((p) => [p.id, { osmRef: p.osmRef, stops: p.tracks.map((t) => t.stopId) }]))
    expect(platforms).toEqual({
      canarsie: { osmRef: 'way/509025060', stops: ['L03N', 'L03S'] },
      'lexington-uptown': { osmRef: 'way/509025013', stops: ['635N'] },
      'lexington-downtown': { osmRef: 'way/509025007', stops: ['635S'] },
      'broadway-uptown': { osmRef: 'way/509025035', stops: ['R20N'] },
      'broadway-downtown': { osmRef: 'way/509025036', stops: ['R20S'] },
    })
  })

  it('joins the Canarsie platform to each Broadway platform by its OSM stair', () => {
    for (const [id, upper] of [['st-509025053', 'broadway-uptown'], ['st-509025055', 'broadway-downtown']] as const) {
      const c = interior.connectors.find((k) => k.id === id)!
      expect(c, id).toBeDefined()
      expect([c.kind, c.lower.area, c.upper.area, c.osmRef], id).toEqual(['stair', 'canarsie', upper, `way/${id.slice(3)}`])
      expect(c.sources, id).toContain('osm')
    }
  })

  it('maps L03 and R20 to the 635 file in the index', () => {
    const index = json<StationIndex>('stations/index.json')
    expect(index.stations['635']).toEqual({ provenance: 'authored' })
    expect(index.stations.L03).toEqual({ provenance: 'authored', file: '635' })
    expect(index.stations.R20).toEqual({ provenance: 'authored', file: '635' })
  })

  it('packs depths for every member, and the map rides both directions at each', () => {
    const stations = json<StationsFile>('stations.json')
    const shapes = drawnLines(json<ShapesFile>('shapes.json').shapes, TRACK_OFFSET_M)
    const { depths } = decodeStationDepths(json<PackedDepthsFile>('station-depths.json'), stations, shapes)
    const mine = depths.stations.filter((s) => MEMBERS.includes(s.stationId))
    expect(mine.map((s) => [s.stationId, s.tracks.map((t) => t.stopId)])).toEqual([['635', ['635N', '635S']], ['L03', ['L03N', 'L03S']], ['R20', ['R20N', 'R20S']]])
    const { runs, unmatched } = profileRuns(
      { ...depths, stations: mine },
      stations.stations.map((s) => ({ id: s.id, routeIds: s.routes })),
      shapes,
    )
    expect(unmatched).toEqual([])
    const direction = new Map(shapes.map((s) => [s.id, s.direction]))
    const ridden = new Set([...runs].flatMap(([shapeId, list]) => list.map((r) => `${r.stationId}${direction.get(shapeId)}`)))
    expect([...ridden].sort()).toEqual(['635N', '635S', 'L03N', 'L03S', 'R20N', 'R20S'])
  }, 60_000)
})
