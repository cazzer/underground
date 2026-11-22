/**
 * Walking routes over one station's walk graph (`WalkGraph`): snap a point to the nearest walkable edge, then a
 * multi-source A* from several snapped starts (each with its own head start) to one snapped target. Times are
 * seconds at `WALK_SPEED_MPS`, with roads priced up by `WALK_FACTORS`. Pure; the graph is read, never changed.
 */
import { WALK_KINDS, type WalkGraph, type WalkKind } from '../data/walkSchema'
import { MinHeap } from './minHeap'
import { slicePolyline } from './planGeometry'
import type { LocalPoint } from '../data/stationSchema'
import type { Ground } from './projection'

/** Walking pace, meters per second. */
export const WALK_SPEED_MPS = 1.3
/** Time multiplier per way kind: a named road is a walk along traffic, so it costs 30% more than a footway. */
export const WALK_FACTORS: Readonly<Record<WalkKind, number>> = {
  sidewalk: 1,
  crossing: 1,
  footway: 1,
  steps: 1,
  path: 1,
  pedestrian: 1,
  road: 1.3,
}

export interface WalkOptions {
  /** Forbid steps, and snap only to the largest component that remains. */
  stepFree?: boolean
}

/** A graph prepared for one set of options: per-edge costs, the main component, and the A* heuristic scale. */
export interface WalkQuery {
  graph: WalkGraph
  /** Seconds to walk each whole edge; Infinity when forbidden. */
  edgeS: Float64Array
  /** 1 for an allowed edge in the component with the most nodes (the one a point may snap to), else 0. */
  inMain: Uint8Array
  /** The least seconds per meter of any allowed edge: the A* heuristic's scale. */
  minSPerM: number
}

/** A point on an edge: its distance share along the edge polyline, 0 at the first node and 1 at the last. */
export interface WalkSnap {
  edge: number
  share: number
  /** The snapped point, in graph-local meters. */
  point: Ground
  /** Meters from the queried point to `point`. */
  offsetM: number
}

/** A start with a head start: `startS` seconds already spent before the walk begins at `snap`. */
export interface WalkSource {
  snap: WalkSnap
  startS: number
}

export interface WalkPath {
  /** Index of the winning source. */
  source: number
  /** Total seconds, the source's `startS` included. */
  seconds: number
  /** Meters walked, from the source's snap to the target's. */
  meters: number
  /** Graph-local points from the source's snap to the target's. */
  points: Ground[]
}

export function walkQuery(graph: WalkGraph, opts: WalkOptions = {}): WalkQuery {
  const stepFree = opts.stepFree === true
  const edgeCount = graph.edgeLength.length
  const edgeS = new Float64Array(edgeCount)
  let minFactor = Infinity
  for (let k = 0; k < WALK_KINDS.length; k++) {
    if (!(stepFree && WALK_KINDS[k] === 'steps')) minFactor = Math.min(minFactor, WALK_FACTORS[WALK_KINDS[k]!])
  }
  const parent = new Int32Array(graph.x.length)
  for (let n = 0; n < parent.length; n++) parent[n] = n
  const find = (n: number): number => {
    while (parent[n] !== n) {
      parent[n] = parent[parent[n]!]!
      n = parent[n]!
    }
    return n
  }
  for (let e = 0; e < edgeCount; e++) {
    const kind = WALK_KINDS[graph.edgeKind[e]!]!
    edgeS[e] = stepFree && kind === 'steps' ? Infinity : (graph.edgeLength[e]! * WALK_FACTORS[kind]) / WALK_SPEED_MPS
    if (edgeS[e] === Infinity) continue
    const nodes = graph.edgeNodes[e]!
    for (let i = 1; i < nodes.length; i++) parent[find(nodes[i]!)] = find(nodes[i - 1]!)
  }
  const size = new Int32Array(parent.length)
  for (let n = 0; n < parent.length; n++) size[find(n)]!++
  let main = 0
  for (let n = 1; n < size.length; n++) if (size[n]! > size[main]!) main = n
  const inMain = new Uint8Array(edgeCount)
  for (let e = 0; e < edgeCount; e++) {
    if (edgeS[e] !== Infinity && find(graph.edgeNodes[e]![0]!) === main) inMain[e] = 1
  }
  return { graph, edgeS, inMain, minSPerM: minFactor / WALK_SPEED_MPS }
}

/** The nearest point on any allowed edge of the main component; null when the graph has none. */
export function snapToWalk(q: WalkQuery, p: Ground): WalkSnap | null {
  const { graph } = q
  let bestD = Infinity
  let bestEdge = -1
  let bestAlong = 0
  let bestPoint: Ground = p
  for (let e = 0; e < q.inMain.length; e++) {
    if (q.inMain[e] === 0) continue
    const nodes = graph.edgeNodes[e]!
    let run = 0
    for (let i = 1; i < nodes.length; i++) {
      const ax = graph.x[nodes[i - 1]!]!
      const az = graph.z[nodes[i - 1]!]!
      const dx = graph.x[nodes[i]!]! - ax
      const dz = graph.z[nodes[i]!]! - az
      const len2 = dx * dx + dz * dz
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / len2))
      const px = ax + t * dx
      const pz = az + t * dz
      const d = Math.hypot(p.x - px, p.z - pz)
      const len = Math.sqrt(len2)
      if (d < bestD) {
        bestD = d
        bestEdge = e
        bestAlong = run + t * len
        bestPoint = { x: px, z: pz }
      }
      run += len
    }
  }
  if (bestEdge < 0) return null
  const total = graph.edgeLength[bestEdge]!
  return { edge: bestEdge, share: total === 0 ? 0 : Math.min(1, bestAlong / total), point: bestPoint, offsetM: bestD }
}

function edgePoints(graph: WalkGraph, e: number): LocalPoint[] {
  return Array.from(graph.edgeNodes[e]!, (n): LocalPoint => [graph.x[n]!, graph.z[n]!])
}

/** Points closer than this are one point (a share's float error, not geometry). */
const SAME_POINT_M = 1e-6

/** Marks a target reached straight along its own edge from a source (no graph node between). */
const DIRECT = -2

/**
 * The quickest walk from any of `sources` to `target`: A* over the nodes plus one virtual target node, seeded at each
 * source edge's two ends. Null when there are no sources or none reaches the target. Costs and a path's points
 * follow the edges' polylines; the source and target snap points are the path's two ends.
 */
export function routeWalk(q: WalkQuery, sources: readonly WalkSource[], target: WalkSnap): WalkPath | null {
  const { graph, edgeS } = q
  const nodeCount = graph.x.length
  const T = nodeCount
  const dist = new Float64Array(nodeCount + 1).fill(Infinity)
  const prevNode = new Int32Array(nodeCount + 1).fill(-1)
  const prevEdge = new Int32Array(nodeCount + 1).fill(-1)
  const seedSource = new Int32Array(nodeCount + 1).fill(-1)
  const closed = new Uint8Array(nodeCount + 1)
  const heap = new MinHeap(256)
  const targetNodes = graph.edgeNodes[target.edge]!
  const tFirst = targetNodes[0]!
  const tLast = targetNodes[targetNodes.length - 1]!
  /** The end of the target's edge the best arrival came from: 0 first node, 1 last. */
  let tSide = 0
  const h = (n: number): number => (n === T ? 0 : Math.hypot(graph.x[n]! - target.point.x, graph.z[n]! - target.point.z) * q.minSPerM)

  const seed = (node: number, cost: number, edge: number, source: number): void => {
    if (!(cost < dist[node]!)) return
    dist[node] = cost
    prevNode[node] = -1
    prevEdge[node] = edge
    seedSource[node] = source
    heap.push(node, cost + h(node))
  }
  sources.forEach((s, i) => {
    const { edge, share } = s.snap
    const nodes = graph.edgeNodes[edge]!
    seed(nodes[0]!, s.startS + share * edgeS[edge]!, edge, i)
    seed(nodes[nodes.length - 1]!, s.startS + (1 - share) * edgeS[edge]!, edge, i)
    if (edge === target.edge) {
      const cost = s.startS + Math.abs(share - target.share) * edgeS[edge]!
      if (cost < dist[T]!) {
        dist[T] = cost
        prevNode[T] = DIRECT
        seedSource[T] = i
        heap.push(T, cost)
      }
    }
  })

  const reach = (n: number): void => {
    const costFirst = n === tFirst ? dist[n]! + target.share * edgeS[target.edge]! : Infinity
    const costLast = n === tLast ? dist[n]! + (1 - target.share) * edgeS[target.edge]! : Infinity
    const cost = Math.min(costFirst, costLast)
    if (cost < dist[T]!) {
      dist[T] = cost
      prevNode[T] = n
      tSide = costFirst <= costLast ? 0 : 1
      heap.push(T, cost)
    }
  }

  for (let n = heap.pop(); n >= 0; n = heap.pop()) {
    if (closed[n] === 1) continue
    closed[n] = 1
    if (n === T) return buildPath(graph, sources, target, prevNode, prevEdge, seedSource, tSide, dist[T]!)
    if (n === tFirst || n === tLast) reach(n)
    for (let i = graph.adjStart[n]!; i < graph.adjStart[n + 1]!; i++) {
      const e = graph.adjEdge[i]!
      if (edgeS[e] === Infinity) continue
      const nodes = graph.edgeNodes[e]!
      const m = nodes[0] === n ? nodes[nodes.length - 1]! : nodes[0]!
      const cost = dist[n]! + edgeS[e]!
      if (cost < dist[m]!) {
        dist[m] = cost
        prevNode[m] = n
        prevEdge[m] = e
        heap.push(m, cost + h(m))
      }
    }
  }
  return null
}

function buildPath(
  graph: WalkGraph,
  sources: readonly WalkSource[],
  target: WalkSnap,
  prevNode: Int32Array,
  prevEdge: Int32Array,
  seedSource: Int32Array,
  tSide: number,
  seconds: number,
): WalkPath {
  const T = graph.x.length
  const source = seedSource[prevNode[T] === DIRECT ? T : walkBack(prevNode, T)]!
  const snap = sources[source]!.snap
  const sourceEdge = graph.edgeLength[snap.edge]!
  const tm = target.share * graph.edgeLength[target.edge]!
  const raw: LocalPoint[] = [[snap.point.x, snap.point.z]]
  const add = (pts: readonly LocalPoint[]): void => {
    for (const p of pts) {
      const last = raw[raw.length - 1]!
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > SAME_POINT_M) raw.push(p)
    }
  }
  if (prevNode[T] === DIRECT) {
    add(slicePolyline(edgePoints(graph, snap.edge), snap.share * sourceEdge, tm))
  } else {
    // Nodes from the target back to the seeded one, then forward.
    const chain: number[] = []
    for (let n = prevNode[T]!; n >= 0; n = prevNode[n]!) chain.push(n)
    chain.reverse()
    const first = chain[0]!
    const sNodes = graph.edgeNodes[snap.edge]!
    const toFirst = sNodes[0] === sNodes[sNodes.length - 1] ? snap.share <= 0.5 : sNodes[0] === first
    add(slicePolyline(edgePoints(graph, snap.edge), snap.share * sourceEdge, toFirst ? 0 : sourceEdge))
    for (let i = 1; i < chain.length; i++) {
      const e = prevEdge[chain[i]!]!
      const along = graph.edgeNodes[e]![0] === chain[i - 1] ? [0, graph.edgeLength[e]!] : [graph.edgeLength[e]!, 0]
      add(slicePolyline(edgePoints(graph, e), along[0]!, along[1]!))
    }
    const tLen = graph.edgeLength[target.edge]!
    add(slicePolyline(edgePoints(graph, target.edge), tSide === 0 ? 0 : tLen, tm))
  }
  const end = raw[raw.length - 1]!
  const goal: LocalPoint = [target.point.x, target.point.z]
  if (Math.hypot(end[0] - goal[0], end[1] - goal[1]) > SAME_POINT_M) raw.push(goal)
  else raw[raw.length - 1] = goal
  let meters = 0
  for (let i = 1; i < raw.length; i++) meters += Math.hypot(raw[i]![0] - raw[i - 1]![0], raw[i]![1] - raw[i - 1]![1])
  return { source, seconds, meters, points: raw.map(([x, z]) => ({ x, z })) }
}

/** The seeded node a predecessor chain from T ends at. */
function walkBack(prevNode: Int32Array, T: number): number {
  let n = prevNode[T]!
  while (prevNode[n] !== -1) n = prevNode[n]!
  return n
}
