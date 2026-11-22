/** Synthetic two-station complex for the merge, depths and index tests. Frame bearing 90 deg, so [u, v] maps to
 *  [x, z] as-is. Station T01 sits at v = 0 and U01 at v = 50, one platform level (-9) under one mezzanine level (-4)
 *  that holds a slab for each station and a walkway between them.
 *  Platforms: island-t u -30..30, v -3..3 (tracks T01N v -2.5, T01S v 2.5, u -40..40); island-u v 47..53 (U01N 47.5,
 *  U01S 52.5). Slabs: mezz-t u -30..-10, v -20..10; mezz-u u -30..-10, v 40..60. */
import type { AuthoredStation, StationSources } from './stationInputs.ts'
import { ANCHOR, ll } from './stationFixture.ts'

const ring = (u0: number, u1: number, v0: number, v1: number): [number, number][] =>
  [[u0, v0], [u1, v0], [u1, v1], [u0, v1], [u0, v0]].map(([u, v]) => ll(u!, v!))

export function complexFixture(): { authored: AuthoredStation; sources: StationSources } {
  const authored: AuthoredStation = {
    stationId: 'T01',
    memberStationIds: ['T01', 'U01'],
    name: 'Test Complex',
    notes: ['UNVERIFIED: everything here is made up.'],
    frame: { anchor: ANCHOR, bearingDeg: 90 },
    fetch: { osmWays: [1, 2], entrancesGtfsStopId: ['T01', 'U01'], equipmentStationMrn: ['1', '2'] },
    levels: [
      { id: 'platform', name: 'Platform', kind: 'platform', y: -9 },
      { id: 'street', name: 'Street', kind: 'street', y: 0 },
      { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: -4 },
    ],
    platforms: [
      { id: 'island-t', level: 'platform', osmWay: 1, tracks: [
        { stopId: 'T01N', path: [[-40, -2.5], [40, -2.5]] },
        { stopId: 'T01S', path: [[-40, 2.5], [40, 2.5]] },
      ] },
      { id: 'island-u', level: 'platform', osmWay: 2, tracks: [
        { stopId: 'U01N', path: [[-40, 47.5], [40, 47.5]] },
        { stopId: 'U01S', path: [[-40, 52.5], [40, 52.5]] },
      ] },
    ],
    slabs: [
      { id: 'mezz-t', level: 'mezz', name: 'T mezzanine', outline: [[-30, -20], [-10, -20], [-10, 10], [-30, 10]], paid: true },
      { id: 'mezz-u', level: 'mezz', name: 'U mezzanine', outline: [[-30, 40], [-10, 40], [-10, 60], [-30, 60]], paid: true },
    ],
    entrances: [
      { id: 'ent-t', source: ll(-12, -14) },
      { id: 'ent-u', source: ll(-12, 64) },
    ],
    connectors: [
      { id: 'st-street-t', kind: 'stair', width: 1.5, lower: { level: 'mezz', at: [-12, -9], area: 'mezz-t' }, upper: { entrance: 'ent-t' } },
      { id: 'st-street-u', kind: 'stair', width: 1.5, lower: { level: 'mezz', at: [-12, 55], area: 'mezz-u' }, upper: { entrance: 'ent-u' } },
      { id: 'st-plat-t', kind: 'stair', width: 2.4, lower: { level: 'platform', at: [-12, 0], area: 'island-t' }, upper: { level: 'mezz', at: [-21, 0], area: 'mezz-t' } },
      { id: 'st-plat-u', kind: 'stair', width: 2.4, lower: { level: 'platform', at: [-12, 50], area: 'island-u' }, upper: { level: 'mezz', at: [-21, 50], area: 'mezz-u' } },
      { id: 'wk-1', kind: 'walkway', width: 4, lower: { level: 'mezz', at: [-20, 9], area: 'mezz-t' }, upper: { level: 'mezz', at: [-20, 41], area: 'mezz-u' } },
    ],
    equipment: [],
    fareLines: [],
  }
  const sources: StationSources = {
    stationId: 'T01',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    osm: {
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      query: 'way(id:1,2)',
      baseTimestamp: '2026-01-01T00:00:00Z',
      ways: [
        { id: 1, version: 3, timestamp: '2025-01-01T00:00:00Z', tags: { level: '-2' }, ring: ring(-30, 30, -3, 3) },
        { id: 2, version: 3, timestamp: '2025-01-01T00:00:00Z', tags: { level: '-2' }, ring: ring(-30, 30, 47, 53) },
      ],
    },
    entrances: {
      dataset: 'i9wp-a4ja',
      url: 'x',
      rowsUpdatedAt: '2026-01-01T00:00:00.000Z',
      rows: [
        { type: 'Stair', entry: true, exit: true, lat: ll(-12, -14)[0], lon: ll(-12, -14)[1] },
        { type: 'Stair', entry: true, exit: true, lat: ll(-12, 64)[0], lon: ll(-12, 64)[1] },
      ],
    },
    equipment: { dataset: '94fv-bak7', url: 'x', rowsUpdatedAt: '2026-01-01T00:00:00.000Z', rows: [] },
  }
  return { authored, sources }
}
