/** Builds one station's street file (public/data/streets/<id>.json, contract in src/data/streetSchema.ts) from the
 *  pinned ways: clip to the radius, project onto the station point in integer decimeters, simplify, pack the node
 *  table, join the entrances. Pure; everything after the projection works on the rounded values. */
import { deltaEncode } from '../../src/data/codec.ts'
import type { Station, StationId } from '../../src/data/schema.ts'
import type { StationStreets, StreetWay } from '../../src/data/streetSchema.ts'
import { toGround } from '../../src/lib/projection.ts'
import { isClosedRing } from '../../src/lib/streetClass.ts'
import { ENTRANCES_OPEN_NY_NOTE, MTA_CREDIT } from './stationMerge.ts'
import { simplifyIndices } from './simplify.ts'
import { buildEntrances, type BuildLog, type EntranceInput } from './streetsEntrances.ts'
import { RADIUS_M, ROAD_CLASSES, type PinNode, type PinWay } from './streetsOsm.ts'
import { waysNear, type Pin } from './streetsPin.ts'

/** Footways, steps and paths (everything but the named roadway classes) are kept this far from the station point;
 *  named roadways are kept to RADIUS_M, the pin's radius. The one lever for the per-file size cap: lower it for
 *  every file, never for one. 100 m is the least that fits every file under 16 KB with room (200 m left two over). */
export const WALK_RADIUS_M = 100
/** Douglas-Peucker tolerance for dropping vertices, meters. */
export const SIMPLIFY_TOL_M = 0.5

const OSM_CREDIT = '© OpenStreetMap contributors'
const ONEWAY_FORWARD = new Set(['yes', 'true', '1'])
const ONEWAY_BACKWARD = new Set(['-1', 'reverse'])
const ONEWAY_NONE = new Set(['no', 'false', '0', 'reversible', 'alternating'])

/** The vehicle one-way value of an OSM `oneway` tag; an unknown value is 0 and `known` false (logged by the caller). */
export function onewayOf(tag: string | undefined): { value: 0 | 1 | -1; known: boolean } {
  if (tag === undefined || ONEWAY_NONE.has(tag)) return { value: 0, known: true }
  if (ONEWAY_FORWARD.has(tag)) return { value: 1, known: true }
  if (ONEWAY_BACKWARD.has(tag)) return { value: -1, known: true }
  return { value: 0, known: false }
}

type Pt = readonly [x: number, z: number]

function segmentDistanceToOrigin(a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dz) / len2))
  return Math.hypot(a[0] + t * dx, a[1] + t * dz)
}

/** The inclusive vertex range of the way to keep, or null when no segment comes within `radius` of the origin.
 *  A segment counts when any part of it does, so a long one with both ends outside is kept. An open way is kept from
 *  the start of its first in-range segment to the end of its last, so one that leaves and re-enters is one span; a
 *  closed way (`closed`) is kept whole or dropped, never opened. Units of `points` and `radius` agree. */
export function clipSpan(points: readonly Pt[], radius: number, closed: boolean): [first: number, last: number] | null {
  let first = -1
  let last = -1
  for (let i = 0; i + 1 < points.length; i++) {
    if (segmentDistanceToOrigin(points[i]!, points[i + 1]!) > radius) continue
    if (first === -1) first = i
    last = i
  }
  if (first === -1) return null
  return closed ? [0, points.length - 1] : [first, last + 1]
}

/** Drops vertices within `toleranceM` of a straight run, keeping every vertex used by two or more spans (a ring's
 *  closing repeat counts once) and every span's ends. A ring left with fewer than 4 entries keeps all its vertices.
 *  `spans` are node-id lists; `ptOf` gives a node's decimeter point. */
export function simplifySpans(spans: readonly (readonly number[])[], ptOf: (id: number) => Pt, toleranceM: number): number[][] {
  const uses = new Map<number, number>()
  for (const nodes of spans) {
    const end = isClosedRing(nodes) ? nodes.length - 1 : nodes.length
    for (let i = 0; i < end; i++) uses.set(nodes[i]!, (uses.get(nodes[i]!) ?? 0) + 1)
  }
  return spans.map((nodes) => {
    const pinned = nodes.map((id, i) => i === 0 || i === nodes.length - 1 || uses.get(id)! >= 2)
    const kept: number[] = [nodes[0]!]
    let from = 0
    for (let i = 1; i < nodes.length; i++) {
      if (!pinned[i]) continue
      const stretch = nodes.slice(from, i + 1).map((id) => {
        const p = ptOf(id)
        return { x: p[0] / 10, z: p[1] / 10 }
      })
      for (const k of simplifyIndices(stretch, toleranceM).slice(1)) kept.push(nodes[from + k]!)
      from = i
    }
    return isClosedRing(nodes) && kept.length < 4 ? [...nodes] : kept
  })
}

export interface StationStreetsResult {
  file: StationStreets
  log: BuildLog[]
}

/** The street file of `station` from the pin and the catalog entrances that list it. Every way the pin has near it
 *  is a candidate, but only the part within the radius is kept. */
export function buildStationStreets(station: Station, pin: Pin, rows: readonly EntranceInput[]): StationStreetsResult {
  const who = `${station.id} ${station.name}`
  const log: BuildLog[] = []
  const dm = new Map<number, Pt>()
  const ptOf = (id: number): Pt => {
    let p = dm.get(id)
    if (p === undefined) {
      const n: PinNode = pin.nodes.get(id)!
      const g = toGround({ lat: n[0], lon: n[1] }, station)
      p = [Math.round(g.x * 10) + 0, Math.round(g.z * 10) + 0]
      dm.set(id, p)
    }
    return p
  }

  const kept: { way: PinWay; nodes: number[] }[] = []
  const reach = Math.max(RADIUS_M, WALK_RADIUS_M)
  for (const { way } of waysNear(pin, station, reach)) {
    const road = way.tags.name !== undefined && ROAD_CLASSES.includes(way.tags.highway ?? '')
    const closed = isClosedRing(way.nodes)
    const span = clipSpan(way.nodes.map(ptOf), (road ? RADIUS_M : WALK_RADIUS_M) * 10, closed)
    if (span === null) continue
    let nodes = way.nodes.slice(span[0], span[1] + 1)
    if (!closed && isClosedRing(nodes)) {
      nodes = way.nodes
      log.push({ kind: 'whole-way', line: `open way ${way.id} would clip to a ring; kept whole: ${who}` })
    }
    kept.push({ way, nodes })
  }

  const simple = simplifySpans(kept.map((k) => k.nodes), ptOf, SIMPLIFY_TOL_M)
  const ids = [...new Set(simple.flat())].sort((a, b) => a - b)
  const index = new Map(ids.map((id, i) => [id, i]))
  const x = ids.map((id) => ptOf(id)[0])
  const z = ids.map((id) => ptOf(id)[1])
  const ways: StreetWay[] = kept.map(({ way }, i) => {
    const oneway = onewayOf(way.tags.oneway)
    if (!oneway.known) log.push({ kind: 'oneway', line: `way ${way.id}: unknown oneway=${way.tags.oneway}, read as two-way: ${who}` })
    return {
      id: way.id,
      highway: way.tags.highway!,
      ...(way.tags.footway === undefined ? {} : { footway: way.tags.footway }),
      name: way.tags.name ?? null,
      oneway: oneway.value,
      nodes: simple[i]!.map((id) => index.get(id)!),
    }
  })
  // The pin lists ways by id (loadPin), so `ways` already is in id order.
  const tags = new Map(kept.map((k) => [k.way.id, k.way.tags]))
  if (ways.length === 0) log.push({ kind: 'no-ways', line: `WARNING: no pinned ways within ${RADIUS_M} m, wrote an empty street file: ${who}` })

  const joined = buildEntrances(station, rows, { ways, x, z, tags })
  const file: StationStreets = {
    stationId: station.id,
    anchor: { lat: station.lat, lon: station.lon },
    format: 1,
    license: 'ODbL-1.0',
    attribution: [OSM_CREDIT, ...(joined.entrances.length > 0 ? [MTA_CREDIT, ENTRANCES_OPEN_NY_NOTE] : [])],
    osmTimestamp: pin.baseTimestamp,
    radiusM: RADIUS_M,
    walkRadiusM: WALK_RADIUS_M,
    nodeId: deltaEncode(ids),
    x,
    z,
    ways,
    entrances: joined.entrances,
  }
  return { file, log: [...log, ...joined.log] }
}

/** Every station's file, in station order; `rowsOf` gives the catalog rows listing a station id. */
export function buildAllStreets(
  stations: readonly Station[],
  pin: Pin,
  rowsOf: ReadonlyMap<StationId, readonly EntranceInput[]>,
): StationStreetsResult[] {
  return stations.map((s) => buildStationStreets(s, pin, rowsOf.get(s.id) ?? []))
}
