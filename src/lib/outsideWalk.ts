/**
 * The walk outside a station between a street exit (or entrance) and a point on the street: over the station's walk
 * graph when the point can be snapped to it, else a straight line priced with `WALK_DETOUR`. Shared by the exit
 * (exit to destination, `chooseExit`) and the way in (entrance to origin, `chooseEntry`: the graph is undirected, so
 * the search runs entrance to place and the caller reverses the points). Pure.
 */
import type { WalkGraph } from '../data/walkSchema'
import type { InStationRoute } from './interiorGraph'
import type { Ground } from './projection'
import { routeWalk, snapToWalk, walkQuery, WALK_SPEED_MPS, type WalkSource } from './walkRoute'

/** A straight line to the destination is walked this much farther, around blocks, past the shard's reach. */
export const WALK_DETOUR = 1.3

export type ExitWalk =
  /** Over the walk graph: scene points from the exit to the destination. */
  | { kind: 'route'; points: Ground[]; meters: number; seconds: number }
  /** Past the graph's reach: the straight line, priced with `WALK_DETOUR`. */
  | { kind: 'estimate'; meters: number; seconds: number }

export interface Outside {
  route: InStationRoute
  walk: ExitWalk
  totalS: number
}

export function straightLine(from: Ground, to: Ground): number {
  return Math.hypot(to.x - from.x, to.z - from.z)
}

/** Whether `point` lies within the graph's radius of its anchor, so the shard is complete there. */
export function withinWalkReach(walk: WalkGraph, point: Ground): boolean {
  return Math.hypot(point.x - walk.anchor.x, point.z - walk.anchor.z) <= walk.radiusM
}

/** Over the walk graph, from every exit at once; null when the destination or no exit can be snapped to it. */
export function walkOutside(
  routes: InStationRoute[],
  exitScene: Ground[],
  destination: Ground,
  walk: WalkGraph,
  stepFree: boolean,
): Outside | null {
  const q = walkQuery(walk, { stepFree })
  const local = (g: Ground): Ground => ({ x: g.x - walk.anchor.x, z: g.z - walk.anchor.z })
  const target = snapToWalk(q, local(destination))
  if (!target) return null
  const sources: WalkSource[] = []
  const origin: number[] = []
  routes.forEach((route, i) => {
    const snap = snapToWalk(q, local(exitScene[i]!))
    if (!snap) return
    sources.push({ snap, startS: route.seconds + snap.offsetM / WALK_SPEED_MPS })
    origin.push(i)
  })
  const path = routeWalk(q, sources, target)
  if (!path) return null
  const i = origin[path.source]!
  const route = routes[i]!
  const snap = sources[path.source]!.snap
  const lastLeg = target.offsetM / WALK_SPEED_MPS
  const points = [exitScene[i]!, ...path.points.map((p) => ({ x: p.x + walk.anchor.x, z: p.z + walk.anchor.z })), destination]
  return {
    route,
    totalS: path.seconds + lastLeg,
    walk: { kind: 'route', points, meters: snap.offsetM + path.meters + target.offsetM, seconds: path.seconds - route.seconds + lastLeg },
  }
}

/** Past the graph: the exit that minimizes its in-station time plus the straight line at `WALK_DETOUR`. */
export function estimateOutside(routes: InStationRoute[], exitScene: Ground[], destination: Ground): Outside {
  let best = 0
  let bestS = Infinity
  routes.forEach((route, i) => {
    const s = route.seconds + (straightLine(exitScene[i]!, destination) * WALK_DETOUR) / WALK_SPEED_MPS
    if (s < bestS) {
      best = i
      bestS = s
    }
  })
  const meters = straightLine(exitScene[best]!, destination)
  return { route: routes[best]!, totalS: bestS, walk: { kind: 'estimate', meters, seconds: (meters * WALK_DETOUR) / WALK_SPEED_MPS } }
}

/** The outside walk for the best of `routes`: over the graph when the point is within its reach and snaps, else estimated. */
export function chooseOutside(routes: InStationRoute[], exitScene: Ground[], point: Ground, walk: WalkGraph | null, stepFree: boolean): Outside {
  const inReach = walk !== null && withinWalkReach(walk, point)
  return (inReach ? walkOutside(routes, exitScene, point, walk, stepFree) : null) ?? estimateOutside(routes, exitScene, point)
}
