/** Pure side of the street pin: the Overpass query, the trim of its response and the coverage check.
 *  A way is kept whole, never clipped (the per-station build clips), when any *segment* of it passes within
 *  a radius of a station point. Everything fetched is untrusted: failures name the element.
 *  ROAD_CLASSES and WALK_CLASSES may be narrower than src/lib/streetClass.ts' ROADWAY_HIGHWAYS, never wider
 *  (streetsOsm.test.ts checks). */
import type { Ground, LatLon } from '../../src/lib/projection.ts'
import { toGround } from '../../src/lib/projection.ts'
import { finite, list, record, text } from './check.ts'

/** Streets a car drives on (trunk is in: West St) plus pedestrian streets; always named. No motorway, no *_link. */
export const ROAD_CLASSES: readonly string[] = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'pedestrian']
/** Where people walk, named or not: sidewalks and crossings are `footway` with `footway=sidewalk|crossing`. */
export const WALK_CLASSES: readonly string[] = ['pedestrian', 'footway', 'steps', 'path']
export const STREET_TAGS: readonly string[] = ['highway', 'name', 'oneway', 'footway', 'crossing', 'foot', 'access', 'area', 'bridge', 'tunnel', 'layer', 'level']
export const RADIUS_M = 300

/** GTFS station ids allowed to have no named way within RADIUS_M. Add an id only with a comment saying why. */
export const UNCOVERED_STATIONS: readonly string[] = []

export interface StreetStation extends LatLon {
  id: string
  name: string
}

export interface PinWay {
  id: number
  /** Only STREET_TAGS, raw. */
  tags: Record<string, string>
  /** OSM node ids in way order (a closed way repeats its first). */
  nodes: number[]
}

export type PinNode = readonly [lat: number, lon: number]

export interface TrimmedStreets {
  baseTimestamp: string
  /** Sorted by id. */
  ways: PinWay[]
  /** Every node any kept way uses. */
  nodes: Map<number, PinNode>
}

export interface StreetsOptions {
  radiusM: number
  /** Include the unnamed and named walking ways; false keeps the named roads only. */
  walk: boolean
  /** Station ids allowed to have no named way within the radius (see UNCOVERED_STATIONS). */
  exceptions?: readonly string[]
}

export interface QueryParts {
  head: string
  /** One per station; LAT and LON stand for its point. */
  perStation: string
  tail: string
}

const classRegex = (classes: readonly string[]): string => `"^(${classes.join('|')})$"`

export function streetsQueryParts(radiusM: number, walk: boolean): QueryParts {
  const walking = walk ? `way.near["highway"~${classRegex(WALK_CLASSES)}];` : ''
  return {
    head: '[out:json][timeout:600];(',
    perStation: `way(around:${radiusM},LAT,LON)["highway"];`,
    tail: `)->.near;(way.near["highway"~${classRegex(ROAD_CLASSES)}]["name"];${walking});out geom;`,
  }
}

/** One Overpass request: the ways within the radius of any of `stations`, as `out geom` (no meta, so no contributor names). */
export function streetsQuery(stations: readonly LatLon[], radiusM: number, walk: boolean): string {
  const parts = streetsQueryParts(radiusM, walk)
  const clauses = stations.map((s) => parts.perStation.replace('LAT', String(s.lat)).replace('LON', String(s.lon)))
  return parts.head + clauses.join('') + parts.tail
}

/** Combines the answers of several requests into one: elements deduplicated by type and id (the first wins),
 *  the earliest base timestamp. A `remark` in any part throws, as in the trim. */
export function mergeOverpass(parts: readonly unknown[]): unknown {
  if (parts.length === 0) throw new Error('mergeOverpass: no responses')
  const seen = new Set<string>()
  const elements: unknown[] = []
  const stamps: string[] = []
  parts.forEach((part, p) => {
    const root = record(part, `overpass[${p}]`)
    if (typeof root.remark === 'string') throw new Error(`overpass[${p}] remark (the answer may be partial): ${root.remark}`)
    stamps.push(text(record(root.osm3s, `overpass[${p}].osm3s`).timestamp_osm_base, `overpass[${p}].osm3s.timestamp_osm_base`))
    list(root.elements, `overpass[${p}].elements`).forEach((raw, i) => {
      const el = record(raw, `overpass[${p}].elements[${i}]`)
      const key = `${String(el.type)}/${String(el.id)}`
      if (seen.has(key)) return
      seen.add(key)
      elements.push(el)
    })
  })
  return { osm3s: { timestamp_osm_base: stamps.sort()[0] }, elements }
}

/** Meters from the point to the segment ab. */
function segmentDistanceM(p: Ground, a: Ground, b: Ground): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

/** Station grid with cell = radius, so a segment checks only the cells under its box plus one on each side. */
function stationsNearSegment(stations: readonly LatLon[], radiusM: number): (a: Ground, b: Ground) => number[] {
  const ground = stations.map((s) => toGround(s))
  const cells = new Map<string, number[]>()
  const key = (cx: number, cz: number): string => `${cx},${cz}`
  ground.forEach((g, i) => {
    const k = key(Math.floor(g.x / radiusM), Math.floor(g.z / radiusM))
    cells.set(k, [...(cells.get(k) ?? []), i])
  })
  return (a, b) => {
    const x0 = Math.floor(Math.min(a.x, b.x) / radiusM) - 1
    const x1 = Math.floor(Math.max(a.x, b.x) / radiusM) + 1
    const z0 = Math.floor(Math.min(a.z, b.z) / radiusM) - 1
    const z1 = Math.floor(Math.max(a.z, b.z) / radiusM) + 1
    const hits: number[] = []
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        for (const i of cells.get(key(cx, cz)) ?? []) if (segmentDistanceM(ground[i]!, a, b) <= radiusM) hits.push(i)
      }
    }
    return hits
  }
}

/** The stations with no named way within `radiusM`: a response cut short, or an area OSM does not map.
 *  Used on the fetch and on the committed shards (`nodes` is the union of their node tables). */
export function stationsWithoutNamedWay(stations: readonly StreetStation[], ways: readonly PinWay[], nodes: ReadonlyMap<number, PinNode>, radiusM: number): StreetStation[] {
  const near = stationsNearSegment(stations, radiusM)
  const covered = new Set<number>()
  for (const way of ways) {
    if (way.tags.name === undefined) continue
    const g = way.nodes.map((id) => {
      const n = nodes.get(id)
      if (n === undefined) throw new Error(`way ${way.id}: node ${id} is not in the node table`)
      return toGround({ lat: n[0], lon: n[1] })
    })
    for (let i = 1; i < g.length; i++) for (const s of near(g[i - 1]!, g[i]!)) covered.add(s)
  }
  return stations.filter((_, i) => !covered.has(i))
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6

function osmId(v: unknown, path: string): number {
  const n = finite(v, path)
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${path}: expected a positive integer id, got ${JSON.stringify(v)}`)
  return n
}

/** Overpass `out geom` JSON to the street ways near a station, sorted by id, with a node table. Throws on a
 *  `remark` (Overpass answers HTTP 200 with a runtime error and partial elements), a missing base timestamp,
 *  a non-way element, a highway class outside ROAD_CLASSES (plus WALK_CLASSES when `walk`), a road with no
 *  name, a duplicate way id, malformed geometry, a node id with two coordinates, and when a station has no
 *  named way within the radius unless it is in `exceptions`. */
export function trimOverpassStreets(json: unknown, stations: readonly StreetStation[], options: StreetsOptions): TrimmedStreets {
  const root = record(json, 'overpass')
  if (typeof root.remark === 'string') throw new Error(`overpass remark (the answer may be partial): ${root.remark}`)
  const baseTimestamp = text(record(root.osm3s, 'overpass.osm3s').timestamp_osm_base, 'overpass.osm3s.timestamp_osm_base')
  const allowed = new Set([...ROAD_CLASSES, ...(options.walk ? WALK_CLASSES : [])])
  const near = stationsNearSegment(stations, options.radiusM)
  const ways: PinWay[] = []
  const nodes = new Map<number, PinNode>()
  const seen = new Set<number>()
  list(root.elements, 'overpass.elements').forEach((raw, i) => {
    const el = record(raw, `overpass.elements[${i}]`)
    const at = `overpass ${String(el.type)} ${String(el.id)}`
    if (el.type !== 'way') throw new Error(`${at}: expected a way`)
    const id = osmId(el.id, `${at}.id`)
    if (seen.has(id)) throw new Error(`${at}: duplicate way id`)
    seen.add(id)
    const tags = record(el.tags, `${at}.tags`)
    const highway = text(tags.highway, `${at}.tags.highway`)
    if (!allowed.has(highway)) throw new Error(`${at}: unexpected highway=${highway}${options.walk ? '' : ' (walking ways are off)'}`)
    if (tags.name === undefined && !(options.walk && WALK_CLASSES.includes(highway))) throw new Error(`${at}: highway=${highway} has no name`)
    const ids = list(el.nodes, `${at}.nodes`).map((n, j) => osmId(n, `${at}.nodes[${j}]`))
    const points = list(el.geometry, `${at}.geometry`).map((p, j): PinNode => {
      const pt = record(p, `${at}.geometry[${j}]`)
      return [round6(finite(pt.lat, `${at}.geometry[${j}].lat`)), round6(finite(pt.lon, `${at}.geometry[${j}].lon`))]
    })
    if (points.length !== ids.length) throw new Error(`${at}: ${ids.length} node ids but ${points.length} geometry points`)
    if (points.length < 2) throw new Error(`${at}.geometry: expected at least 2 points, got ${points.length}`)
    const g = points.map(([lat, lon]) => toGround({ lat, lon }))
    if (!g.some((p, j) => j > 0 && near(g[j - 1]!, p).length > 0)) return
    ids.forEach((nid, j) => {
      const prev = nodes.get(nid)
      const pt = points[j]!
      if (prev !== undefined && (prev[0] !== pt[0] || prev[1] !== pt[1])) {
        throw new Error(`${at}: node ${nid} is at ${pt.join(',')} here but ${prev.join(',')} in another way`)
      }
      nodes.set(nid, pt)
    })
    const kept = STREET_TAGS.filter((k) => tags[k] !== undefined)
    for (const k of kept) if (typeof tags[k] !== 'string') throw new Error(`${at}.tags.${k}: expected a string, got ${JSON.stringify(tags[k])}`)
    ways.push({ id, tags: Object.fromEntries(kept.map((k) => [k, tags[k] as string])), nodes: ids })
  })
  ways.sort((a, b) => a.id - b.id)
  const bare = stationsWithoutNamedWay(stations, ways, nodes, options.radiusM).filter((s) => !(options.exceptions ?? []).includes(s.id))
  if (bare.length > 0) {
    const names = bare.slice(0, 10).map((s) => `${s.id} ${s.name}`).join(', ')
    throw new Error(`overpass: ${bare.length} of ${stations.length} stations have no named way within ${options.radiusM} m (${names}); the response may be incomplete`)
  }
  return { baseTimestamp, ways, nodes }
}
