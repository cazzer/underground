/** Pure trimming of one citywide Overpass response (platform and subway-track ways, platform relation
 *  ids) for the station catalog. A way is kept whole, never clipped, when any vertex is within a
 *  radius of a station point. Everything fetched is untrusted: failures name the element. */
import type { LatLon } from '../../src/lib/projection.ts'
import { toGround } from '../../src/lib/projection.ts'
import { finite, list, record, text } from './check.ts'
import type { OsmCatalogWay } from './catalogTypes.ts'

/** operator and network stay on platforms, raw, so PATH and other non-NYCT platforms can be told apart. */
export const PLATFORM_TAGS = ['railway', 'public_transport', 'subway', 'train', 'level', 'layer', 'name', 'ref', 'local_ref', 'area', 'tunnel', 'indoor', 'operator', 'network']
export const TRACK_TAGS = ['railway', 'level', 'layer', 'tunnel', 'bridge', 'service', 'usage', 'name', 'ref', 'railway:track_ref', 'network', 'operator']

/** Track operator and network values that nearly every track carries; dropped so the file keeps only
 *  the tags that tell a track apart (a missing operator means NYCT, a missing network means NYC Subway). */
const TRACK_DEFAULTS: Record<string, string> = { operator: 'New York City Transit Authority', network: 'NYC Subway' }

export interface CatalogRadii {
  platformRadiusM: number
  trackRadiusM: number
  /** GTFS stop ids allowed to have no platform way within platformRadiusM (name them in a comment). */
  platformExceptions?: readonly string[]
}

export interface CatalogStationPoint extends LatLon {
  gtfsStopId: string
  name: string
}

export interface Bbox {
  south: number
  west: number
  north: number
  east: number
}

/** The box around the points, padded by `padM` and rounded outward to 5 decimals. */
export function catalogBbox(points: readonly LatLon[], padM = 500): Bbox {
  if (points.length === 0) throw new Error('catalogBbox: no points')
  const lats = points.map((p) => p.lat)
  const lons = points.map((p) => p.lon)
  const south = Math.min(...lats)
  const north = Math.max(...lats)
  const metersPerLat = 111_320
  const dLat = padM / metersPerLat
  const dLon = padM / (metersPerLat * Math.cos((((south + north) / 2) * Math.PI) / 180))
  const down = (n: number): number => Math.floor(n * 1e5) / 1e5
  const up = (n: number): number => Math.ceil(n * 1e5) / 1e5
  return { south: down(south - dLat), west: down(Math.min(...lons) - dLon), north: up(north + dLat), east: up(Math.max(...lons) + dLon) }
}

/** Grid of station points so each vertex checks only the stations in its 3x3 cells. */
function nearFinder(points: readonly LatLon[], cellM: number): (p: LatLon, radiusM: number) => boolean {
  const cells = new Map<string, { x: number; z: number }[]>()
  const key = (cx: number, cz: number): string => `${cx},${cz}`
  for (const p of points) {
    const g = toGround(p)
    const k = key(Math.floor(g.x / cellM), Math.floor(g.z / cellM))
    cells.set(k, [...(cells.get(k) ?? []), g])
  }
  return (p, radiusM) => {
    if (radiusM > cellM) throw new Error(`radius ${radiusM} m is larger than the ${cellM} m grid cell`)
    const g = toGround(p)
    const cx = Math.floor(g.x / cellM)
    const cz = Math.floor(g.z / cellM)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (cells.get(key(cx + dx, cz + dz))?.some((s) => Math.hypot(s.x - g.x, s.z - g.z) <= radiusM)) return true
      }
    }
    return false
  }
}

export interface OverpassCatalog {
  baseTimestamp: string
  platforms: OsmCatalogWay[]
  tracks: OsmCatalogWay[]
  /** Platform relations (multipolygons) the catalog does not model; listed so they can be picked up later. */
  skippedRelations: number[]
}

/** The stations with no platform vertex within `radiusM`: a response cut short by a timeout, or an area
 *  OSM does not map. Used on the fetch and on the committed file. */
export function stationsWithoutPlatform(stations: readonly CatalogStationPoint[], platforms: readonly OsmCatalogWay[], radiusM: number): CatalogStationPoint[] {
  const vertices = platforms.flatMap((w) => w.points.map(([lat, lon]) => toGround({ lat, lon })))
  return stations.filter((s) => {
    const g = toGround(s)
    return !vertices.some((v) => Math.hypot(v.x - g.x, v.z - g.z) <= radiusM)
  })
}

const byId = (a: OsmCatalogWay, b: OsmCatalogWay): number => a.id - b.id

/** Overpass `out geom` JSON to the platform and track ways near a station, each sorted by id. Ways tagged
 *  railway=platform use the platform radius and tag list, railway=subway the track ones; any other way
 *  throws. Throws on a `remark` (Overpass answers HTTP 200 with a runtime error and partial elements) and
 *  when a station has no platform within the radius, unless it is in `platformExceptions`. */
export function trimOverpassCatalog(json: unknown, stations: readonly CatalogStationPoint[], radii: CatalogRadii): OverpassCatalog {
  const root = record(json, 'overpass')
  if (typeof root.remark === 'string') throw new Error(`overpass remark (the answer may be partial): ${root.remark}`)
  const baseTimestamp = text(record(root.osm3s, 'overpass.osm3s').timestamp_osm_base, 'overpass.osm3s.timestamp_osm_base')
  const near = nearFinder(stations, Math.max(radii.platformRadiusM, radii.trackRadiusM))
  const platforms: OsmCatalogWay[] = []
  const tracks: OsmCatalogWay[] = []
  const skippedRelations: number[] = []
  list(root.elements, 'overpass.elements').forEach((raw, i) => {
    const el = record(raw, `overpass.elements[${i}]`)
    const id = finite(el.id, `overpass.elements[${i}].id`)
    if (el.type === 'relation') {
      skippedRelations.push(id)
      return
    }
    const at = `overpass ${String(el.type)} ${id}`
    if (el.type !== 'way') throw new Error(`${at}: expected a way or relation`)
    const tags = record(el.tags, `${at}.tags`)
    const platform = tags.railway === 'platform'
    if (!platform && tags.railway !== 'subway') throw new Error(`${at}: unexpected railway=${JSON.stringify(tags.railway)}`)
    const points = list(el.geometry, `${at}.geometry`).map((p, j): [number, number] => {
      const pt = record(p, `${at}.geometry[${j}]`)
      return [finite(pt.lat, `${at}.geometry[${j}].lat`), finite(pt.lon, `${at}.geometry[${j}].lon`)]
    })
    if (points.length < 2) throw new Error(`${at}.geometry: expected at least 2 points, got ${points.length}`)
    if (!points.some(([lat, lon]) => near({ lat, lon }, platform ? radii.platformRadiusM : radii.trackRadiusM))) return
    const first = points[0]!
    const last = points[points.length - 1]!
    const kept = (platform ? PLATFORM_TAGS : TRACK_TAGS).filter((k) => typeof tags[k] === 'string' && (platform || tags[k] !== TRACK_DEFAULTS[k]))
    const way: OsmCatalogWay = {
      id,
      tags: Object.fromEntries(kept.map((k) => [k, tags[k] as string])),
      closed: points.length >= 4 && first[0] === last[0] && first[1] === last[1],
      points,
    }
    ;(platform ? platforms : tracks).push(way)
  })
  platforms.sort(byId)
  tracks.sort(byId)
  const exceptions = new Set(radii.platformExceptions ?? [])
  const bare = stationsWithoutPlatform(stations, platforms, radii.platformRadiusM).filter((s) => !exceptions.has(s.gtfsStopId))
  if (bare.length > 0) {
    const names = bare.slice(0, 10).map((s) => `${s.gtfsStopId} ${s.name}`).join(', ')
    throw new Error(`overpass: ${bare.length} of ${stations.length} stations have no platform way within ${radii.platformRadiusM} m (${names}); the response may be incomplete`)
  }
  return { baseTimestamp, platforms, tracks, skippedRelations: skippedRelations.sort((a, b) => a - b) }
}
