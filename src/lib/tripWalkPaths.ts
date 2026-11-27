/**
 * A trip's walks between stations along the street network (85r). Pure. A walk leg joins two station points; routed
 * over a station's walk graph (`WalkGraph`, walkRoute.ts) it becomes a polyline of ground points: the station point,
 * its snap onto the graph, the way along it, the other snap and the other station point. Where no path is found, or
 * one that is absurdly long, the walk stays the straight dash.
 *
 * Each pair is routed in both stations' shards (a shard is complete within its radius of its own station and partial
 * beyond) and the shorter path wins, so the result never depends on which way the trip walks; a walk the other way
 * gets the reversed polyline. Each graph returns its fastest path by time (roads cost x1.3); the two candidates are
 * compared by length, and `MAX_DETOUR` caps length.
 */
import type { StationId } from '../data/schema'
import type { WalkGraph } from '../data/walkSchema'
import type { Ground } from './projection'
import type { WalkSpan } from './tripSpans'
import { routeWalk, snapToWalk, walkQuery, type WalkQuery } from './walkRoute'

/** A station point farther than this from the walk graph's nearest edge is not on it (meters). */
export const MAX_SNAP_M = 50
/** A path longer than this times the straight distance is a wrong turn in a partial shard: draw straight. */
export const MAX_DETOUR = 2.5
/** A stub from a station point to its snap shorter than this is dropped (the polyline starts at the station point anyway). */
export const MIN_STUB_M = 1

export type WalkPathResult = { ok: true; path: Ground[]; meters: number } | { ok: false; reason: string }

const queries = new WeakMap<WalkGraph, WalkQuery>()
function queryOf(graph: WalkGraph): WalkQuery {
  let q = queries.get(graph)
  if (!q) {
    q = walkQuery(graph)
    queries.set(graph, q)
  }
  return q
}

function lengthOf(points: readonly Ground[]): number {
  let m = 0
  for (let i = 1; i < points.length; i++) m += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
  return m
}

/** `from` to `to` over one graph, both as scene ground; null when either is not within `MAX_SNAP_M` of it or none connects them. */
function routeIn(graph: WalkGraph, from: Ground, to: Ground): Ground[] | null {
  const q = queryOf(graph)
  const local = (p: Ground): Ground => ({ x: p.x - graph.anchor.x, z: p.z - graph.anchor.z })
  const a = snapToWalk(q, local(from))
  const b = snapToWalk(q, local(to))
  if (!a || !b || a.offsetM > MAX_SNAP_M || b.offsetM > MAX_SNAP_M) return null
  const path = routeWalk(q, [{ snap: a, startS: 0 }], b)
  if (!path) return null
  const ground = path.points.map((p): Ground => ({ x: p.x + graph.anchor.x, z: p.z + graph.anchor.z }))
  // The ends are the station points themselves (where the trip marks sit); a stub under a meter is absorbed into them.
  const startStub = Math.hypot(ground[0]!.x - from.x, ground[0]!.z - from.z)
  const endStub = Math.hypot(ground[ground.length - 1]!.x - to.x, ground[ground.length - 1]!.z - to.z)
  const out: Ground[] = [{ x: from.x, z: from.z }]
  const first = startStub < MIN_STUB_M ? 1 : 0
  const last = endStub < MIN_STUB_M ? ground.length - 1 : ground.length
  for (let i = first; i < last; i++) out.push(ground[i]!)
  out.push({ x: to.x, z: to.z })
  return out
}

/**
 * The street path from `from` (station `fromId`) to `to` (`toId`) over whichever of the two stations' graphs is loaded
 * and routes it shortest. Fails, with the reason, when neither does or the best is over `MAX_DETOUR` times the straight line.
 */
export function transferWalkPath(
  from: Ground,
  to: Ground,
  fromId: StationId,
  toId: StationId,
  graphs: ReadonlyMap<StationId, WalkGraph>,
): WalkPathResult {
  const straight = Math.hypot(to.x - from.x, to.z - from.z)
  // Always route the pair in id order, so both directions find the same path.
  const forward = fromId <= toId
  const [a, b, aId, bId] = forward ? [from, to, fromId, toId] : [to, from, toId, fromId]
  let best: Ground[] | null = null
  let bestM = Infinity
  let loaded = 0
  for (const id of [aId, bId]) {
    const graph = graphs.get(id)
    if (!graph) continue
    loaded++
    const path = routeIn(graph, a, b)
    const m = path ? lengthOf(path) : Infinity
    if (path && m < bestM) {
      best = path
      bestM = m
    }
  }
  if (!best) return { ok: false, reason: loaded === 0 ? 'no walk graph loaded' : 'no path on the walk graph' }
  if (bestM > straight * MAX_DETOUR) return { ok: false, reason: `path ${Math.round(bestM)} m against ${Math.round(straight)} m straight` }
  return { ok: true, path: forward ? best : [...best].reverse(), meters: bestM }
}

/**
 * The walks with `path` set where a street path was found. `onFallback` hears each walk left straight, with the reason
 * (the caller decides how loudly: once per pair).
 */
export function withWalkPaths(
  walks: readonly WalkSpan[],
  graphs: ReadonlyMap<StationId, WalkGraph>,
  onFallback: (walk: WalkSpan, reason: string) => void,
): WalkSpan[] {
  return walks.map((w) => {
    const r = transferWalkPath(w.from, w.to, w.fromStationId, w.toStationId, graphs)
    if (r.ok) return { ...w, path: r.path }
    onFallback(w, r.reason)
    return w
  })
}
