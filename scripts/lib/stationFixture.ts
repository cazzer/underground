/** Synthetic station for the merge tests. Frame bearing 90 deg, so [u, v] maps to [x, z] as-is.
 *  Layout (meters): platform u -30..30, v -3..3; mezzanine slab u -30..-10, v -20..10. */
import { toLatLon } from '../../src/lib/projection.ts'
import type { AuthoredStation, StationSources } from './stationInputs.ts'

export const ANCHOR = { lat: 40.7, lon: -74.0 }

/** Real datasets carry 7 decimal places. */
export function ll(u: number, v: number): [lat: number, lon: number] {
  const p = toLatLon({ x: u, z: v }, ANCHOR)
  return [Math.round(p.lat * 1e7) / 1e7, Math.round(p.lon * 1e7) / 1e7]
}

export function fixture(): { authored: AuthoredStation; sources: StationSources } {
  const authored: AuthoredStation = {
    stationId: 'T01',
    name: 'Test St',
    notes: ['UNVERIFIED: everything here is made up.'],
    frame: { anchor: ANCHOR, bearingDeg: 90 },
    fetch: { osmWays: [1], entrancesGtfsStopId: 'T01', equipmentStationMrn: '1' },
    levels: [
      { id: 'platform', name: 'Platform', kind: 'platform', y: -9 },
      { id: 'street', name: 'Street', kind: 'street', y: 0 },
      { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: -4 },
    ],
    platforms: [
      { id: 'island', level: 'platform', osmWay: 1, tracks: [
        { stopId: 'T01N', path: [[-40, -2.5], [40, -2.5]] },
        { stopId: 'T01S', path: [[-40, 2.5], [40, 2.5]] },
      ] },
    ],
    slabs: [{ id: 'mezz-west', level: 'mezz', name: 'West mezzanine', outline: [[-30, -20], [-10, -20], [-10, 10], [-30, 10]] }],
    entrances: [
      { id: 'stair-ent', source: ll(-12, -14) },
      { id: 'elev-ent', source: ll(-25, -14) },
    ],
    connectors: [
      { id: 'st-street', kind: 'stair', width: 1.5, lower: { level: 'mezz', at: [-12, -9] }, upper: { entrance: 'stair-ent' } },
      { id: 'st-plat', kind: 'stair', width: 2.4, lower: { level: 'platform', at: [-12, 0] }, upper: { level: 'mezz', at: [-21, 0] } },
    ],
    equipment: [{ code: 'EL1', entrance: 'elev-ent' }, { code: 'EL2', at: [-26, 0] }],
    fareLines: [],
  }
  const sources: StationSources = {
    stationId: 'T01',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    osm: {
      license: 'ODbL-1.0',
      attribution: '© OpenStreetMap contributors',
      query: 'way(id:1)',
      baseTimestamp: '2026-01-01T00:00:00Z',
      ways: [{ id: 1, version: 3, timestamp: '2025-01-01T00:00:00Z', tags: { level: '-2' }, ring: [[-30, -3], [30, -3], [30, 3], [-30, 3], [-30, -3]].map(([u, v]) => ll(u!, v!)) }],
    },
    entrances: {
      dataset: 'i9wp-a4ja',
      url: 'x',
      rowsUpdatedAt: '2026-01-01T00:00:00.000Z',
      rows: [
        { type: 'Stair', entry: true, exit: true, lat: ll(-12, -14)[0], lon: ll(-12, -14)[1] },
        { type: 'Elevator', entry: true, exit: false, lat: ll(-25, -14)[0], lon: ll(-25, -14)[1] },
      ],
    },
    equipment: {
      dataset: '94fv-bak7',
      url: 'x',
      rowsUpdatedAt: '2026-01-01T00:00:00.000Z',
      rows: [
        { code: 'EL1', kind: 'elevator', lat: ll(-27, -16)[0], lon: ll(-27, -16)[1], serving: 'Main St (NE corner) to mezzanine for service in both directions' },
        { code: 'EL2', kind: 'elevator', lat: ll(-24, 2)[0], lon: ll(-24, 2)[1], serving: 'mezzanine to platform for service in both directions' },
        { code: 'ES1', kind: 'escalator', lat: ll(-15, 1)[0], lon: ll(-15, 1)[1], serving: 'platform to mezzanine for Main St exit' },
      ],
    },
  }
  return { authored, sources }
}
