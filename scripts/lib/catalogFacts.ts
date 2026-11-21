/** Station catalog (data/stations/catalog/) to StationFacts, one per GTFS station. Pure.
 *  - origin is the 39hk station point; every point is projected around it (x east, z south).
 *  - platforms: closed railway=platform ways of subway or Staten Island Railway (PATH, LIRR, Metro-North,
 *    Amtrak, NJ Transit and AirTrain are dropped) within PLATFORM_RADIUS_M of the point. A
 *    platform belongs to the station point nearest to it, so a parallel line a block away is not claimed.
 *  - tracks: railway=subway ways of NYCT or SIR (not crossovers) within TRACK_RADIUS_M, clipped to
 *    TRACK_CLIP_M. Siding, spur and yard ways stay: OSM tags a station's unused center track that way
 *    (Marcy Av, Bedford-Nostrand Avs, Baychester Av), and Wikipedia counts it. The catalog drops the NYCT
 *    operator tag (catalogOsm.ts), so an absent operator is NYCT; any other operator value is not.
 *  - E&E: revenue machines with the station's MRN. Their lat/lon are unreliable (data/README.md) and only
 *    fill the unused `at`. Entrances: rows listing the GTFS stop id. */
import { REFERENCE, toGround } from '../../src/lib/projection.ts'
import type { LatLon } from '../../src/lib/projection.ts'
import type { LocalPoint } from '../../src/data/stationSchema.ts'
import type { CatalogEntrance, CatalogEquipment, CatalogStation, OsmCatalogWay } from './catalogTypes.ts'
import type { EquipmentFact, PlatformFact, StationFacts, Structure, TrackFact } from './stationFacts.ts'
import { distanceToRing } from './stationGeometry.ts'

export const PLATFORM_RADIUS_M = 150
export const TRACK_RADIUS_M = 150
export const TRACK_CLIP_M = 300
/** Another station point this close to a platform makes its assignment ambiguous. */
export const AMBIGUOUS_STATION_M = 60

export interface Catalog {
  stations: CatalogStation[]
  entrances: CatalogEntrance[]
  equipment: CatalogEquipment[]
  platforms: OsmCatalogWay[]
  tracks: OsmCatalogWay[]
}

const STRUCTURE: Record<CatalogStation['structure'], Structure> = {
  Subway: 'subway',
  Elevated: 'elevated',
  'Open Cut': 'open-cut',
  Viaduct: 'viaduct',
  'At Grade': 'at-grade',
  Embankment: 'embankment',
}
const FOREIGN_PLATFORM = /path|port authority|long island|lirr|metro-north|amtrak|nj ?transit|airtrain/i
const TRACK_OPERATORS = new Set(['Staten Island Rapid Transit Operating Authority'])

/** Subway, SIR or untagged; the catalog keeps operator and network raw on platforms. */
export function isSubwayPlatform(w: OsmCatalogWay): boolean {
  return w.closed && w.points.length >= 4 && !FOREIGN_PLATFORM.test(`${w.tags.operator ?? ''} ${w.tags.network ?? ''}`)
}

/** NYCT (no operator tag in the catalog) or SIR, and not a crossover. */
export function isMainTrack(w: OsmCatalogWay): boolean {
  const op = w.tags.operator
  return w.tags.service !== 'crossover' && (op === undefined || TRACK_OPERATORS.has(op))
}

const project = (p: LatLon, origin: LatLon): LocalPoint => {
  const g = toGround(p, origin)
  return [g.x, g.z]
}
/** Citywide frame for distance tests; the equirectangular error over the city is far below the radii. */
const city = (p: LatLon): LocalPoint => project(p, REFERENCE)
const at = (p: [number, number]): LatLon => ({ lat: p[0], lon: p[1] })

function segmentDistance(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
}

/** The run of `w` from the first to the last segment within `clipM` of the station, in the station's
 *  local frame. Segments, not vertices: a straight track can have no vertex near the station. */
function clippedTrack(ground: LocalPoint[], station: LocalPoint, origin: LatLon, w: OsmCatalogWay, clipM: number): LocalPoint[] | null {
  const near = ground.slice(1).map((p, i) => segmentDistance(station, ground[i]!, p) <= clipM)
  const first = near.indexOf(true)
  if (first === -1) return null
  const last = near.lastIndexOf(true)
  return w.points.slice(first, last + 2).map((p) => project(at(p), origin))
}

function equipmentFact(e: CatalogEquipment, origin: LatLon): EquipmentFact {
  return {
    code: e.code,
    kind: e.kind,
    serving: e.serving ?? '',
    rise: e.rise,
    at: e.lat !== null && e.lon !== null ? project({ lat: e.lat, lon: e.lon }, origin) : [0, 0],
  }
}

export function buildAllFacts(c: Catalog): StationFacts[] {
  const platforms = c.platforms.filter(isSubwayPlatform)
  const tracks = c.tracks.filter(isMainTrack).map((w) => ({ w, ground: w.points.map((p) => city(at(p))) }))
  const complexSize = new Map<string, number>()
  for (const s of c.stations) complexSize.set(s.complexId, (complexSize.get(s.complexId) ?? 0) + 1)
  const stationAt = c.stations.map((s) => city(s))

  // Each platform goes to the nearest station point (distance to the polygon, 0 when inside).
  const assigned = new Map<string, OsmCatalogWay[]>()
  const ambiguity = new Map<string, string[]>()
  for (const w of platforms) {
    const ring = w.points.slice(0, -1).map((p) => city(at(p)))
    const near = c.stations
      .map((s, i) => ({ s, d: distanceToRing(stationAt[i]!, ring) }))
      .filter((x) => x.d <= PLATFORM_RADIUS_M)
      .sort((a, b) => a.d - b.d)
    const best = near[0]
    if (!best) continue
    assigned.set(best.s.gtfsStopId, [...(assigned.get(best.s.gtfsStopId) ?? []), w])
    const rivals = near.slice(1).filter((x) => x.d <= AMBIGUOUS_STATION_M)
    if (rivals.length > 0 && best.d <= AMBIGUOUS_STATION_M) {
      const note = `platform way ${w.id} is also within ${AMBIGUOUS_STATION_M} m of ${rivals.map((x) => `${x.s.gtfsStopId} ${x.s.name}`).join(', ')}`
      ambiguity.set(best.s.gtfsStopId, [...(ambiguity.get(best.s.gtfsStopId) ?? []), note])
    }
  }

  return c.stations.map((s, i): StationFacts => {
    const origin: LatLon = { lat: s.lat, lon: s.lon }
    const ownTracks: TrackFact[] = []
    for (const { w, ground } of tracks) {
      const path = ground.slice(1).some((p, k) => segmentDistance(stationAt[i]!, ground[k]!, p) <= TRACK_RADIUS_M)
        ? clippedTrack(ground, stationAt[i]!, origin, w, TRACK_CLIP_M)
        : null
      if (path) ownTracks.push({ ref: String(w.id), source: 'osm', path })
    }
    return {
      stationId: s.gtfsStopId,
      name: s.name,
      origin,
      structure: STRUCTURE[s.structure],
      complex: (complexSize.get(s.complexId) ?? 0) > 1,
      platforms: (assigned.get(s.gtfsStopId) ?? []).map((w): PlatformFact => ({
        osmWay: w.id,
        outline: w.points.slice(0, -1).map((p) => project(at(p), origin)),
        levelTag: w.tags.level ?? null,
      })),
      tracks: ownTracks,
      equipment: c.equipment.filter((e) => e.revenue && e.stationId === s.stationId).map((e) => equipmentFact(e, origin)),
      entrances: c.entrances.filter((e) => e.gtfsStopIds.includes(s.gtfsStopId)).map((e) => ({ at: project(e, origin), type: e.type })),
      ...(ambiguity.has(s.gtfsStopId) ? { ambiguity: ambiguity.get(s.gtfsStopId)! } : {}),
    }
  })
}
