/** Pure trimming of one citywide Overpass response (platform and subway-track ways, platform relation
 *  ids) for the station catalog. A way is kept whole, never clipped, when any vertex is within a
 *  radius of a station point. Everything fetched is untrusted: failures name the element. */
import type { LatLon } from '../../src/lib/projection.ts'
import { toGround } from '../../src/lib/projection.ts'
import { finite, list, record, text } from './check.ts'
import type { OsmCatalogWay } from './catalogTypes.ts'

export const PLATFORM_TAGS = ['railway', 'public_transport', 'subway', 'train', 'level', 'layer', 'name', 'ref', 'local_ref', 'area', 'tunnel', 'indoor']
export const TRACK_TAGS = ['railway', 'level', 'layer', 'tunnel', 'bridge', 'service', 'usage', 'name', 'ref', 'railway:track_ref', 'network', 'operator']

export interface CatalogRadii {
  platformRadiusM: number
  trackRadiusM: number
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
  ways: OsmCatalogWay[]
  /** Platform relations (multipolygons) the catalog does not model; listed so they can be picked up later. */
  skippedRelations: number[]
}

/** Overpass `out meta geom` JSON to the ways near a station, sorted by id. Ways tagged railway=platform
 *  use the platform radius and tag list, railway=subway the track ones; any other way throws. */
export function trimOverpassCatalog(json: unknown, stations: readonly LatLon[], radii: CatalogRadii): OverpassCatalog {
  const root = record(json, 'overpass')
  const baseTimestamp = text(record(root.osm3s, 'overpass.osm3s').timestamp_osm_base, 'overpass.osm3s.timestamp_osm_base')
  const near = nearFinder(stations, Math.max(radii.platformRadiusM, radii.trackRadiusM))
  const ways: OsmCatalogWay[] = []
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
    const radius = platform ? radii.platformRadiusM : radii.trackRadiusM
    if (!points.some(([lat, lon]) => near({ lat, lon }, radius))) return
    const first = points[0]
    const last = points[points.length - 1]
    const closed = points.length >= 4 && first![0] === last![0] && first![1] === last![1]
    const kept = platform ? PLATFORM_TAGS : TRACK_TAGS
    ways.push({
      id,
      version: finite(el.version, `${at}.version`),
      tags: Object.fromEntries(kept.filter((k) => typeof tags[k] === 'string').map((k) => [k, tags[k] as string])),
      closed,
      points,
    })
  })
  return { baseTimestamp, ways: ways.sort((a, b) => a.id - b.id), skippedRelations: skippedRelations.sort((a, b) => a - b) }
}
