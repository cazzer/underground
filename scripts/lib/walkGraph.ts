/** Builds one station's walk graph (public/data/walk/<id>.json, contract in src/data/walkSchema.ts) from the pinned
 *  ways: every walkable way within the radius, clipped and projected exactly as the street files do (so a node has the
 *  same x/z in both), simplified, cut into edges at every junction, packed. Pure. */
import { deltaEncode } from '../../src/data/codec.ts'
import type { Station } from '../../src/data/schema.ts'
import { WALK_KINDS, type StationWalk, type WalkKind } from '../../src/data/walkSchema.ts'
import { toGround } from '../../src/lib/projection.ts'
import { isClosedRing } from '../../src/lib/streetClass.ts'
import { clipSpan, simplifySpans } from './streetsBuild.ts'
import { ROAD_CLASSES, type PinNode, type PinWay } from './streetsOsm.ts'
import { waysNear, type Pin } from './streetsPin.ts'

/** The walk files are complete this far from the station point (the pin's radius). */
export const WALK_GRAPH_RADIUS_M = 300
/** Douglas-Peucker tolerance for dropping vertices, meters (the street files' value). */
export const WALK_SIMPLIFY_TOL_M = 0.5

const OSM_CREDIT = '© OpenStreetMap contributors'
const FOOT_BLOCKED = new Set(['no', 'private', 'use_sidepath'])
const ACCESS_BLOCKED = new Set(['no', 'private'])
const FOOT_ALLOWED = new Set(['yes', 'designated', 'permissive'])

type Pt = readonly [x: number, z: number]

/** False for a way pedestrians may not use: `foot=no|private|use_sidepath`, or `access=no|private` unless `foot` allows
 *  it. `access=destination|customers|delivery` and `foot=discouraged` stay (people do walk them). */
export function isWalkable(tags: Readonly<Record<string, string>>): boolean {
  const foot = tags.foot
  if (foot !== undefined && FOOT_BLOCKED.has(foot)) return false
  const access = tags.access
  return !(access !== undefined && ACCESS_BLOCKED.has(access) && !(foot !== undefined && FOOT_ALLOWED.has(foot)))
}

/** The edge kind of a walkable way. Throws on a highway class the pin should not hold. */
export function walkKind(way: PinWay): WalkKind {
  const highway = way.tags.highway
  if (highway === 'steps') return 'steps'
  if (highway === 'footway') {
    if (way.tags.footway === 'sidewalk') return 'sidewalk'
    return way.tags.footway === 'crossing' || way.tags.crossing !== undefined ? 'crossing' : 'footway'
  }
  if (highway === 'path') return 'path'
  if (highway === 'pedestrian') return 'pedestrian'
  if (highway !== undefined && ROAD_CLASSES.includes(highway)) return 'road'
  throw new Error(`way ${way.id}: highway=${String(highway)} is not a class the walk graph knows`)
}

/** How many spans use each node; a ring's closing repeat counts once (as in `simplifySpans`). */
export function nodeUses(spans: readonly (readonly number[])[]): Map<number, number> {
  const uses = new Map<number, number>()
  for (const nodes of spans) {
    const end = isClosedRing(nodes) ? nodes.length - 1 : nodes.length
    for (let i = 0; i < end; i++) uses.set(nodes[i]!, (uses.get(nodes[i]!) ?? 0) + 1)
  }
  return uses
}

/** Each span cut into edges at its ends and at every node used two or more times. `span` indexes `spans`. A ring with
 *  no junction stays one edge, first equal to last. */
export function splitEdges(spans: readonly (readonly number[])[]): { span: number; nodes: number[] }[] {
  const uses = nodeUses(spans)
  const edges: { span: number; nodes: number[] }[] = []
  spans.forEach((nodes, span) => {
    let from = 0
    for (let i = 1; i < nodes.length; i++) {
      if (i < nodes.length - 1 && uses.get(nodes[i]!)! < 2) continue
      edges.push({ span, nodes: nodes.slice(from, i + 1) })
      from = i
    }
  })
  return edges
}

/** Integer decimeters along a polyline of decimeter points. */
export function edgeLengthDm(points: readonly Pt[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
  return Math.round(sum)
}

export interface StationWalkResult {
  file: StationWalk
  /** Ways within the radius that `isWalkable` dropped. */
  excluded: number
}

/** The walk file of `station` from the pin. Every way the pin has near it is a candidate, but only the part within the
 *  radius is kept. */
export function buildStationWalk(station: Station, pin: Pin): StationWalkResult {
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

  let excluded = 0
  const kept: { way: PinWay; kind: WalkKind; nodes: number[] }[] = []
  for (const { way } of waysNear(pin, station, WALK_GRAPH_RADIUS_M)) {
    const closed = isClosedRing(way.nodes)
    const span = clipSpan(way.nodes.map(ptOf), WALK_GRAPH_RADIUS_M * 10, closed)
    if (span === null) continue
    if (!isWalkable(way.tags)) {
      excluded++
      continue
    }
    let nodes = way.nodes.slice(span[0], span[1] + 1)
    // An open way whose clipped span closes on itself would read as a ring (never simplified, never cut open): keep it whole.
    if (!closed && isClosedRing(nodes)) nodes = way.nodes
    kept.push({ way, kind: walkKind(way), nodes })
  }

  const simple = simplifySpans(kept.map((k) => k.nodes), ptOf, WALK_SIMPLIFY_TOL_M)
  const edges = splitEdges(simple)
  const ids = [...new Set(edges.flatMap((e) => e.nodes))].sort((a, b) => a - b)
  const index = new Map(ids.map((id, i) => [id, i]))
  const file: StationWalk = {
    stationId: station.id,
    anchor: { lat: station.lat, lon: station.lon },
    format: 1,
    license: 'ODbL-1.0',
    attribution: [OSM_CREDIT],
    osmTimestamp: pin.baseTimestamp,
    radiusM: WALK_GRAPH_RADIUS_M,
    nodeId: deltaEncode(ids),
    x: ids.map((id) => ptOf(id)[0]),
    z: ids.map((id) => ptOf(id)[1]),
    edgeWay: deltaEncode(edges.map((e) => kept[e.span]!.way.id)),
    edgeKind: edges.map((e) => WALK_KINDS.indexOf(kept[e.span]!.kind)),
    edgeLength: edges.map((e) => edgeLengthDm(e.nodes.map(ptOf))),
    edgeNodes: edges.map((e) => e.nodes.map((id) => index.get(id)!)),
  }
  return { file, excluded }
}

export function buildAllWalks(stations: readonly Station[], pin: Pin): StationWalkResult[] {
  return stations.map((s) => buildStationWalk(s, pin))
}

/** The share of total edge length in the biggest connected component, and the component count. No edges: 1 and 0. */
export function largestComponentShare(file: StationWalk): { share: number; components: number } {
  const parent = file.nodeId.map((_, i) => i)
  const find = (a: number): number => {
    let r = a
    while (parent[r] !== r) r = parent[r]!
    return r
  }
  for (const nodes of file.edgeNodes) {
    const root = find(nodes[0]!)
    for (const n of nodes) parent[find(n)] = root
  }
  const weight = new Map<number, number>()
  file.edgeNodes.forEach((nodes, e) => {
    const r = find(nodes[0]!)
    weight.set(r, (weight.get(r) ?? 0) + file.edgeLength[e]!)
  })
  if (weight.size === 0) return { share: 1, components: 0 }
  const total = [...weight.values()].reduce((a, b) => a + b, 0)
  return { share: total === 0 ? 1 : Math.max(...weight.values()) / total, components: weight.size }
}
