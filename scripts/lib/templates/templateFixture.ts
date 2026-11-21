/** SYNTHETIC one-station catalogs for the template tests, laid out in a [u, v] frame (u along `bearingDeg`, v to
 *  its right) around ANCHOR. Platforms run u -75..75 and tracks u -300..300. Nothing here is surveyed. */
import type { Direction, StationId } from '../../../src/data/schema.ts'
import type { LocalPoint } from '../../../src/data/stationSchema.ts'
import { toGround, toLatLon } from '../../../src/lib/projection.ts'
import type { CatalogStation } from '../catalogTypes.ts'
import { fromUV } from '../platformAxis.ts'
import type { GeneratorCatalog } from './slice.ts'
import type { MapTrackLines } from './tracks.ts'

export const ANCHOR = { lat: 40.65, lon: -73.95 }
const PLATFORM_U: [number, number] = [-75, 75]
const TRACK_U: [number, number] = [-300, 300]
/** The map draws each direction this far right of the shared centerline (TRACK_OFFSET_M is 4.7). */
const MAP_LINE_V = 4.7

export interface FixtureSpec {
  id: string
  structure: CatalogStation['structure']
  bearingDeg: number
  /** [v0, v1] of each platform polygon. */
  platforms: [number, number][]
  /** v of each track. */
  tracks: number[]
  levelTag: string | null
  entrances: { type: string; at: [number, number] }[]
  equipment: { code: string; kind: 'elevator' | 'escalator'; serving: string; at?: [number, number] }[]
  /** The side (sign of v) of the map's northbound line. */
  northSide: -1 | 1
  northLabel?: string
  southLabel?: string
}

export function latLonAt(spec: Pick<FixtureSpec, 'bearingDeg'>, [u, v]: [number, number]): [lat: number, lon: number] {
  const [x, z] = fromUV([u, v], { bearingDeg: spec.bearingDeg, origin: [0, 0] })
  const p = toLatLon({ x, z }, ANCHOR)
  return [Math.round(p.lat * 1e7) / 1e7, Math.round(p.lon * 1e7) / 1e7]
}

const box = (spec: FixtureSpec, [v0, v1]: [number, number]): [number, number][] => {
  const [u0, u1] = PLATFORM_U
  const ring = ([[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as [number, number][]).map((p) => latLonAt(spec, p))
  return [...ring, ring[0]!]
}

export function fixtureCatalog(spec: FixtureSpec): { catalog: GeneratorCatalog; lines: MapTrackLines } {
  const station: CatalogStation = {
    gtfsStopId: spec.id, stationId: '9001', complexId: '9001', division: 'X', line: 'Test', name: `${spec.id} St`, borough: 'Bk',
    routes: ['T'], structure: spec.structure, lat: ANCHOR.lat, lon: ANCHOR.lon, ada: 0, adaNorth: false, adaSouth: false, adaNotes: null,
    northLabel: spec.northLabel ?? 'Uptown', southLabel: spec.southLabel ?? 'Downtown',
  }
  const tags: Record<string, string> = spec.levelTag === null ? {} : { level: spec.levelTag }
  const catalog: GeneratorCatalog = {
    stations: [station],
    entrances: spec.entrances.map((e) => {
      const [lat, lon] = latLonAt(spec, e.at)
      return { type: e.type, entry: true, exit: true, lat, lon, gtfsStopIds: [spec.id], stationId: '9001', complexId: '9001' }
    }),
    equipment: spec.equipment.map((e) => {
      const [lat, lon] = latLonAt(spec, e.at ?? [0, 0])
      return {
        code: e.code, kind: e.kind, revenue: true, stationId: '9001', complexId: '9001', lat, lon, serving: e.serving, rise: null, landings: null,
        direction: null, ada: null, streetAccess: null, mezzanine1Access: null, mezzanine2Access: null, platformAccess: null,
      }
    }),
    platforms: spec.platforms.map((p, i) => ({ id: 1000 + i, tags: { railway: 'platform', ...tags }, closed: true, points: box(spec, p) })),
    tracks: spec.tracks.map((v, i) => ({ id: 2000 + i, tags: { railway: 'subway' }, closed: false, points: [latLonAt(spec, [TRACK_U[0], v]), latLonAt(spec, [TRACK_U[1], v])] })),
    headers: {
      osm: { fetchedAt: '2026-01-01T00:00:00.000Z', baseTimestamp: '2026-01-01T00:00:00Z', query: 'synthetic' },
      entrances: { url: 'synthetic', rowsUpdatedAt: '2026-01-01T00:00:00.000Z' },
      equipment: { url: 'synthetic', rowsUpdatedAt: '2026-01-01T00:00:00.000Z' },
    },
  }
  const world = (u: number, v: number): LocalPoint => {
    const [lat, lon] = latLonAt(spec, [u, v])
    const g = toGround({ lat, lon })
    return [g.x, g.z]
  }
  const line = (dir: Direction): [LocalPoint, LocalPoint][] => {
    const v = (dir === 'N' ? spec.northSide : -spec.northSide) * MAP_LINE_V
    return [[world(TRACK_U[0], v), world(TRACK_U[1], v)]]
  }
  const lines: MapTrackLines = new Map<StationId, Record<Direction, [LocalPoint, LocalPoint][]>>([[spec.id, { N: line('N'), S: line('S') }]])
  return { catalog, lines }
}

/** Island under a mezzanine (OSM level -2): stairs at both ends, a street elevator with its entrance, a
 *  mezzanine-platform elevator, and rows the merge can't take. */
export const islandCutCover = (northSide: -1 | 1 = 1): FixtureSpec => ({
  id: 'T10',
  structure: 'Subway',
  bearingDeg: 60,
  platforms: [[-3.5, 3.5]],
  tracks: [-5.2, 5.2],
  levelTag: '-2',
  northSide,
  entrances: [
    { type: 'Stair', at: [-62, -14] },
    { type: 'Stair', at: [-64, 14] },
    { type: 'Elevator', at: [-55, 13] },
    { type: 'Stair', at: [62, -14] },
    { type: 'Stair', at: [64, 14] },
    { type: 'Escalator', at: [58, 14] },
  ],
  equipment: [
    { code: 'EL1', kind: 'elevator', serving: 'Main St (NE corner) to mezzanine for service in both directions', at: [-50, 20] },
    { code: 'EL2', kind: 'elevator', serving: 'mezzanine to platform for service in both directions' },
    { code: 'ES8', kind: 'escalator', serving: 'upper mezzanine to lower mezzanine' },
    { code: 'EL9', kind: 'elevator', serving: 'Main St to mezzanine to platform' },
  ],
})

/** Shallow side platforms outside two express tracks (OSM level -1), one entrance per side, and a street elevator
 *  to the platform its serving text names. */
export const sideShallow = (): FixtureSpec => ({
  id: 'T20',
  structure: 'Subway',
  bearingDeg: 28,
  platforms: [[-14, -9], [9, 14]],
  tracks: [-6.6, -2.9, 2.9, 6.6],
  levelTag: '-1',
  northSide: -1,
  northLabel: 'Manhattan',
  southLabel: 'Brooklyn',
  entrances: [
    { type: 'Stair', at: [-60, -20] },
    { type: 'Stair', at: [60, 20] },
    { type: 'Elevator', at: [10, 18] },
  ],
  equipment: [{ code: 'EL5', kind: 'elevator', serving: 'Main St (SE corner) to Manhattan-bound platform', at: [10, 18] }],
})

/** Elevated island (OSM level 2): street stairs and machines have the entrance at their lower end. */
export const elevatedIsland = (): FixtureSpec => ({
  id: 'T30',
  structure: 'Elevated',
  bearingDeg: 100,
  platforms: [[-3.2, 3.2]],
  tracks: [-5, 5],
  levelTag: '2',
  northSide: 1,
  entrances: [
    { type: 'Stair', at: [-10, 12] },
    { type: 'Stair', at: [10, -12] },
    { type: 'Elevator', at: [0, 12] },
    { type: 'Escalator', at: [5, -12] },
  ],
  equipment: [
    { code: 'EL7', kind: 'elevator', serving: 'Main St (NW corner) to platform for service in both directions' },
    { code: 'ES7', kind: 'escalator', serving: 'Main St (SE corner) to mezzanine' },
  ],
})
