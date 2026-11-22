/**
 * A station interior as a graph of walkable places, and the quickest way from a platform track to each street exit.
 * Nodes are connector ends, plus one per exit entrance; edges are the connectors (priced by kind, directed where an
 * escalator runs one way), walks between ends that stand in the same slab or platform, and the walk from a street
 * end to the entrance that lists it. All times are seconds; rises are real, never the drawn exaggeration.
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

/** Where a route meets the street: an entrance, or the street end of a connector no entrance lists. */
export interface StreetExit {
  entranceId: string | null
  /** Interior-local. */
  point: LocalPoint
  /** The entrance's raw type; null for an unlisted end. */
  type: string | null
}

export interface InStationRoute {
  exit: StreetExit
  seconds: number
  /** Platform to street, in travel order. */
  connectorIds: string[]
  /** The platform first, then each slab stood on. */
  areaIds: string[]
  /** The first connector end, on the platform. */
  platformPoint: LocalPoint
  /** Where `platformPoint` projects on the alighting track's path, 0..1 from `path[0]` (path order is not travel order). */
  trackShare: number
}

export interface InteriorRouteOptions {
  /** Only elevators, ramps and walkways. */
  stepFree?: boolean
  /** Connector ids out of service. */
  closed?: ReadonlySet<string>
}

interface Area {
  level: string
  outline: readonly LocalPoint[]
}

function areaIndex(interior: StationInterior): Map<string, Area> {
  const areas = new Map<string, Area>()
  for (const p of interior.platforms) areas.set(p.id, p)
  for (const s of interior.slabs) areas.set(s.id, s)
  return areas
}

function streetLevelId(interior: StationInterior): string {
  const street = interior.levels.find((l) => l.kind === 'street')
  if (!street) throw new Error(`Interior ${interior.stationId} has no street level`)
  return street.id
}

function areaOf(interior: StationInterior, areas: Map<string, Area>, end: Endpoint): string | null {
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

/** The id of the platform or slab an endpoint stands on: its authored `area`, else containment (the nearest outline
 *  within `CONTAINMENT_M`, ties by id); null on the street level. Throws when there is none. */
export function endpointArea(interior: StationInterior, end: Endpoint): string | null {
  return areaOf(interior, areaIndex(interior), end)
}

/** Seconds along a connector, one way. */
function connectorSeconds(c: Connector, rise: number): number {
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

const STEP_FREE_KINDS: ReadonlySet<Connector['kind']> = new Set(['elevator', 'ramp', 'walkway'])

interface Node {
  point: LocalPoint
  area: string | null
}
interface Arc {
  to: number
  s: number
  connector: string | null
}

function dist(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

/**
 * The quickest in-station route from a platform track of `stopId` to every street exit that can be reached, sorted by
 * time (ties in exit order: the entrances, then unlisted street ends). Null when no platform track serves `stopId`;
 * an empty list when none of them reaches an exit (for instance step-free with no elevator).
 */
export function routesToStreet(interior: StationInterior, stopId: StopId, opts: InteriorRouteOptions = {}): InStationRoute[] | null {
  const tracks = interior.platforms.flatMap((p) => p.tracks.filter((t) => t.stopId === stopId).map((t) => ({ platform: p.id, path: t.path })))
  if (tracks.length === 0) return null
  const areas = areaIndex(interior)
  const street = streetLevelId(interior)
  const levelY = new Map(interior.levels.map((l) => [l.id, l.y]))
  const nodes: Node[] = []
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
    const [lo, up] = [c.lower, c.upper].map((e) => addNode([e.x, e.z], areaOf(interior, areas, e))) as [number, number]
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

  interface Exit extends StreetExit {
    node: number
  }
  const exits: Exit[] = []
  const listed = new Set<string>()
  for (const e of interior.entrances) {
    for (const id of e.connectors) listed.add(id)
    if (!e.exit) continue
    const node = addNode([e.x, e.z], null)
    exits.push({ entranceId: e.id, point: [e.x, e.z], type: e.type, node })
    for (const id of e.connectors) {
      const end = streetEnd.get(id)
      if (end !== undefined) link(end, node, dist(nodes[end]!.point, [e.x, e.z]) / WALK_SPEED_MPS, null)
    }
  }
  for (const [id, node] of streetEnd) if (!listed.has(id)) exits.push({ entranceId: null, point: nodes[node]!.point, type: null, node })

  // Multi-source Dijkstra from the platform's connector ends, each starting at its walk from the track. The walk
  // along the platform to the car is not costed (the rider is assumed to board the car nearest the exit), so on a long
  // platform the in-station time understates.
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

  const routes: InStationRoute[] = []
  exits.forEach((exit) => {
    if (d[exit.node]! === Infinity) return
    const path: number[] = []
    const connectorIds: string[] = []
    for (let n = exit.node; n >= 0; n = prev[n]!) {
      path.push(n)
      const via = prevConnector[n] ?? null
      if (via !== null) connectorIds.push(via)
    }
    path.reverse()
    connectorIds.reverse()
    const areaIds: string[] = []
    for (const n of path) {
      const area = nodes[n]!.area
      if (area !== null && area !== areaIds[areaIds.length - 1]) areaIds.push(area)
    }
    const first = path[0]!
    const hit = nearestOnPolyline(tracks[track[first]!]!.path, nodes[first]!.point)
    const { node: _node, ...streetExit } = exit
    routes.push({
      exit: streetExit,
      seconds: d[exit.node]!,
      connectorIds,
      areaIds,
      platformPoint: nodes[first]!.point,
      trackShare: hit.total === 0 ? 0 : hit.along / hit.total,
    })
  })
  return routes.map((r, i) => ({ r, i })).sort((a, b) => a.r.seconds - b.r.seconds || a.i - b.i).map(({ r }) => r)
}
