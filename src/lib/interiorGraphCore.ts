/**
 * The core of the interior route graph (interiorGraph.ts, interiorTransfer.ts): walkable places as nodes (connector
 * ends), connectors as edges priced by kind (directed where an escalator runs one way), walks between ends that stand
 * in one slab or platform, and a multi-source Dijkstra seeded from a stop's platform tracks. All times are seconds;
 * rises are real, never the drawn exaggeration. Pure.
 */
import type { StopId } from '../data/schema'
import type { Connector, Endpoint, LocalPoint, StationInterior } from '../data/stationSchema'
import { MinHeap } from './minHeap'
import { distanceToRing, nearestOnPolyline } from './planGeometry'
import { WALK_SPEED_MPS } from './walkRoute'

/** Stair travel, meters of slope per second. */
export const STAIR_MPS = 0.5
/** Escalator travel, meters of slope per second. */
export const ESCALATOR_MPS = 0.5
/** Waiting for the car, seconds. */
export const ELEVATOR_WAIT_S = 45
/** Elevator travel, meters of rise per second. */
export const ELEVATOR_MPS = 1
/** An endpoint this close (m) to an outline, or inside it, stands in that area. */
export const CONTAINMENT_M = 0.5
/** Plan run per meter of rise for an escalator with no run of its own, a 30 degree incline (see interiorConnectors.ts). */
const ESCALATOR_RUN_PER_RISE = Math.sqrt(3)
/** Below this plan run (m) a connector has no run of its own (`MIN_RUN` in interiorConnectors.ts). */
const NO_RUN_M = 0.01

export const STEP_FREE_KINDS: ReadonlySet<Connector['kind']> = new Set(['elevator', 'ramp', 'walkway'])

export interface Area {
  level: string
  outline: readonly LocalPoint[]
}

export function areaIndex(interior: StationInterior): Map<string, Area> {
  const areas = new Map<string, Area>()
  for (const p of interior.platforms) areas.set(p.id, p)
  for (const s of interior.slabs) areas.set(s.id, s)
  return areas
}

export function streetLevelId(interior: StationInterior): string {
  const street = interior.levels.find((l) => l.kind === 'street')
  if (!street) throw new Error(`Interior ${interior.stationId} has no street level`)
  return street.id
}

export function areaOf(interior: StationInterior, areas: Map<string, Area>, end: Endpoint): string | null {
  if (end.level === streetLevelId(interior)) return null
  const where = `endpoint (${end.x}, ${end.z}) on level "${end.level}" of ${interior.stationId}`
  if (end.area !== undefined) {
    if (areas.get(end.area)?.level !== end.level) throw new Error(`The ${where} names area "${end.area}", which is not an area on that level`)
    return end.area
  }
  let best: string | null = null
  let bestD = Infinity
  for (const [id, area] of areas) {
    if (area.level !== end.level) continue
    const d = distanceToRing([end.x, end.z], area.outline)
    if (d < bestD || (d === bestD && best !== null && id < best)) {
      best = id
      bestD = d
    }
  }
  if (best === null || bestD > CONTAINMENT_M) throw new Error(`The ${where} is ${bestD} m from the nearest slab or platform`)
  return best
}

/** Seconds along a connector, one way. */
export function connectorSeconds(c: Connector, rise: number): number {
  const plan = Math.hypot(c.upper.x - c.lower.x, c.upper.z - c.lower.z)
  switch (c.kind) {
    case 'stair':
      return Math.hypot(plan, rise) / STAIR_MPS
    case 'escalator':
      return Math.hypot(plan >= NO_RUN_M ? plan : rise * ESCALATOR_RUN_PER_RISE, rise) / ESCALATOR_MPS
    case 'elevator':
      return ELEVATOR_WAIT_S + rise / ELEVATOR_MPS
    case 'ramp':
      return Math.hypot(plan, rise) / WALK_SPEED_MPS
    case 'walkway':
      return plan / WALK_SPEED_MPS
    default: {
      const never: never = c.kind
      throw new Error(`Unknown connector kind ${String(never)}`)
    }
  }
}

export interface GraphNode {
  point: LocalPoint
  area: string | null
}
export interface Arc {
  to: number
  s: number
  connector: string | null
}

export interface GraphOptions {
  /** Only elevators, ramps and walkways. */
  stepFree?: boolean
  /** Connector ids out of service. */
  closed?: ReadonlySet<string>
  /** Stay inside fare control: leave out every connector with an end on the street level or in a slab marked unpaid
   *  (`paid === false`). A slab with no `paid` counts as inside. */
  transfer?: boolean
}

export interface InteriorGraph {
  interior: StationInterior
  nodes: GraphNode[]
  arcs: Arc[][]
  /** Nodes below this index are connector ends (two per connector kept); later ones were added by the caller. */
  connectorNodes: number
  /** Connector id to the node of its street end, for each connector kept that reaches the street. */
  streetEnd: Map<string, number>
  addNode: (point: LocalPoint, area: string | null) => number
  link: (a: number, b: number, s: number, connector: string | null) => void
}

export function dist(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/** The connectors (minus closed ones, and with `stepFree` minus stairs and escalators) and the walks between ends
 *  in one area. */
export function buildInteriorGraph(interior: StationInterior, opts: GraphOptions = {}): InteriorGraph {
  const areas = areaIndex(interior)
  const street = streetLevelId(interior)
  const unpaid = new Set(interior.slabs.filter((s) => s.paid === false).map((s) => s.id))
  const levelY = new Map(interior.levels.map((l) => [l.id, l.y]))
  const nodes: GraphNode[] = []
  const arcs: Arc[][] = []
  const addNode = (point: LocalPoint, area: string | null): number => {
    nodes.push({ point, area })
    arcs.push([])
    return nodes.length - 1
  }
  const link = (a: number, b: number, s: number, connector: string | null): void => {
    arcs[a]!.push({ to: b, s, connector })
  }

  const streetEnd = new Map<string, number>()
  for (const c of interior.connectors) {
    if (opts.closed?.has(c.id) || (opts.stepFree === true && !STEP_FREE_KINDS.has(c.kind))) continue
    const [loArea, upArea] = [areaOf(interior, areas, c.lower), areaOf(interior, areas, c.upper)]
    if (opts.transfer === true) {
      const outside = (e: Endpoint, area: string | null): boolean => e.level === street || (area !== null && unpaid.has(area))
      if (outside(c.lower, loArea) || outside(c.upper, upArea)) continue
    }
    const lo = addNode([c.lower.x, c.lower.z], loArea)
    const up = addNode([c.upper.x, c.upper.z], upArea)
    const [yLower, yUpper] = [c.lower.level, c.upper.level].map((id) => {
      const y = levelY.get(id)
      if (y === undefined) throw new Error(`Connector "${c.id}" of ${interior.stationId} is on unknown level "${id}"`)
      return y
    }) as [number, number]
    const rise = Math.abs(yUpper - yLower)
    const s = connectorSeconds(c, rise)
    if (c.travel !== 'down') link(lo, up, s, c.id)
    if (c.travel !== 'up') link(up, lo, s, c.id)
    if (c.lower.level === street) streetEnd.set(c.id, lo)
    else if (c.upper.level === street) streetEnd.set(c.id, up)
  }
  const connectorNodes = nodes.length
  // Ends standing in one area walk to each other.
  for (let a = 0; a < connectorNodes; a++) {
    for (let b = 0; b < connectorNodes; b++) {
      if (a !== b && nodes[a]!.area !== null && nodes[a]!.area === nodes[b]!.area) link(a, b, dist(nodes[a]!.point, nodes[b]!.point) / WALK_SPEED_MPS, null)
    }
  }
  return { interior, nodes, arcs, connectorNodes, streetEnd, addNode, link }
}

/** A platform track a stop is served from. */
export interface StopTrack {
  platform: string
  path: readonly LocalPoint[]
}

/** Every platform track that serves `stopId`. */
export function stopTracks(interior: StationInterior, stopId: StopId): StopTrack[] {
  return interior.platforms.flatMap((p) => p.tracks.filter((t) => t.stopId === stopId).map((t) => ({ platform: p.id, path: t.path })))
}

export interface GraphSearch {
  /** Seconds to each node; Infinity where unreached. */
  d: Float64Array
  prev: Int32Array
  /** The connector the best arc into each node rides; null for a walk. */
  prevConnector: (string | null)[]
  /** For a seed node, the index into the tracks of the one it starts from; -1 elsewhere. */
  track: Int32Array
}

/**
 * Multi-source Dijkstra from the connector ends standing on each track's platform, each starting at its walk from the
 * track. The walk along the platform to the car is not costed (the rider is assumed to ride in the car nearest the
 * connector), so on a long platform the in-station time understates.
 */
export function shortestFrom(graph: InteriorGraph, tracks: readonly StopTrack[]): GraphSearch {
  const { nodes, arcs, connectorNodes } = graph
  const d = new Float64Array(nodes.length).fill(Infinity)
  const prev = new Int32Array(nodes.length).fill(-1)
  const prevConnector: (string | null)[] = new Array<string | null>(nodes.length).fill(null)
  const track = new Int32Array(nodes.length).fill(-1)
  const heap = new MinHeap()
  for (let n = 0; n < connectorNodes; n++) {
    tracks.forEach((t, i) => {
      if (nodes[n]!.area !== t.platform) return
      const s = nearestOnPolyline(t.path, nodes[n]!.point).distance / WALK_SPEED_MPS
      if (s < d[n]!) {
        d[n] = s
        track[n] = i
      }
    })
    if (d[n]! < Infinity) heap.push(n, d[n]!)
  }
  const done = new Uint8Array(nodes.length)
  for (let n = heap.pop(); n >= 0; n = heap.pop()) {
    if (done[n] === 1) continue
    done[n] = 1
    for (const arc of arcs[n]!) {
      if (d[n]! + arc.s < d[arc.to]!) {
        d[arc.to] = d[n]! + arc.s
        prev[arc.to] = n
        prevConnector[arc.to] = arc.connector
        heap.push(arc.to, d[arc.to]!)
      }
    }
  }
  return { d, prev, prevConnector, track }
}

export interface GraphPath {
  /** Node indices, seed first. */
  nodes: number[]
  /** Connectors in travel order. */
  connectorIds: string[]
  /** Each area stood on, in order (consecutive repeats merged). */
  areaIds: string[]
}

/** The best path to `node` (reached: `search.d[node]` finite), traced back to its seed. */
export function pathBack(graph: InteriorGraph, search: GraphSearch, node: number): GraphPath {
  const path: number[] = []
  const connectorIds: string[] = []
  for (let n = node; n >= 0; n = search.prev[n]!) {
    path.push(n)
    const via = search.prevConnector[n] ?? null
    if (via !== null) connectorIds.push(via)
  }
  path.reverse()
  connectorIds.reverse()
  const areaIds: string[] = []
  for (const n of path) {
    const area = graph.nodes[n]!.area
    if (area !== null && area !== areaIds[areaIds.length - 1]) areaIds.push(area)
  }
  return { nodes: path, connectorIds, areaIds }
}
