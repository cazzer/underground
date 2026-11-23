import type { Direction, RouteId, StationId } from '../../data/schema'
import type { Station } from '../network'
import type { Ground } from '../projection'

/** The part of a drawn shape a terminal is read from. */
export interface TerminalShape {
  routeId: RouteId
  direction: Direction
  primary: boolean
  points: readonly Ground[]
}

/**
 * The name a train of `route` going `direction` is bound for at the station made of `memberIds` ("Flushing",
 * "8 Av"), or null when it can't be told: no shape of that route and direction passes the station, or its branches
 * part there so the end depends on the train.
 */
export type TerminalOf = (route: RouteId, direction: Direction, memberIds: readonly StationId[]) => string | null

/** A shape counts as passing a station when its drawn path comes within this many meters of it. */
export const PASS_RADIUS_M = 30

/** Terminals the first-part rule names by their neighbourhood where the line's own sign names the street. */
const SIGNED_NAMES: Readonly<Record<string, string>> = { 'Ozone Park-Lefferts Blvd': 'Lefferts Blvd' }

/**
 * "Flushing-Main St" is "Flushing", "Van Cortlandt Park-242 St" is "Van Cortlandt Park"; a street-number first part
 * gives way to the place after it ("34 St-Hudson Yards" is "Hudson Yards"); a name with no hyphen stays whole ("8 Av").
 */
export function terminalLabel(stationName: string): string {
  const named = SIGNED_NAMES[stationName]
  if (named !== undefined) return named
  const [first = stationName, second] = stationName.split('-')
  return /^\d+ (St|Av)$/.test(first) && second !== undefined && !/^\d/.test(second) ? second : first
}

interface Path {
  points: readonly Ground[]
  /** Distance along the path at each point. */
  cumulative: readonly number[]
}

function pathOf(points: readonly Ground[]): Path {
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    cumulative.push(cumulative[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z))
  }
  return { points, cumulative }
}

/** Where `p` is closest to the path: its distance from it and the distance along the path there. */
function nearestOn(path: Path, p: Ground): { dist: number; along: number } {
  let best = { dist: Infinity, along: 0 }
  for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1]!
    const b = path.points[i]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
    const dist = Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
    if (dist < best.dist) best = { dist, along: path.cumulative[i - 1]! + t * Math.sqrt(len2) }
  }
  return best
}

interface Candidate {
  path: Path
  /** The nearest station the route serves to the path's last point: where this shape's trains end up. */
  end: Station
}

/**
 * Where trains end up, from data loaded at startup and nothing else (no trip index, which loads only with the live
 * feed, and no fetch). The answer depends on the station, since branches part: the candidates are the route's shapes
 * for that direction that pass within PASS_RADIUS_M of a member station; each ends at the nearest station the route
 * serves to its last point. An end that lies on another candidate's path before that candidate's own end is a short
 * turn and is dropped. One distinct end left is the terminal; two or more (a shared stretch where the branches
 * diverge) or none is null, which the panel words "one direction only": honest beats wrong. Memoised per route,
 * direction and station.
 */
export function terminalsOf(shapes: readonly TerminalShape[], stations: readonly Station[]): TerminalOf {
  const byId = new Map(stations.map((s) => [s.id, s]))
  const paths = new Map<TerminalShape, Path>()
  const pathFor = (s: TerminalShape): Path => {
    let p = paths.get(s)
    if (!p) paths.set(s, (p = pathOf(s.points)))
    return p
  }
  const endOf = (route: RouteId, path: Path): Station | null => {
    const last = path.points.at(-1)
    if (!last) return null
    let best: Station | null = null
    let bestD = Infinity
    for (const s of stations) {
      if (!s.routeIds.includes(route)) continue
      const d = (s.pos.x - last.x) ** 2 + (s.pos.z - last.z) ** 2
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }
  const find = (route: RouteId, direction: Direction, memberIds: readonly StationId[]): string | null => {
    const members = memberIds.flatMap((id) => byId.get(id) ?? [])
    const candidates: Candidate[] = []
    for (const shape of shapes) {
      if (shape.routeId !== route || shape.direction !== direction) continue
      const path = pathFor(shape)
      if (!members.some((m) => nearestOn(path, m.pos).dist <= PASS_RADIUS_M)) continue
      const end = endOf(route, path)
      if (end) candidates.push({ path, end })
    }
    const ends = candidates.filter(
      (a) =>
        !candidates.some((b) => {
          if (b.end.id === a.end.id) return false
          const at = nearestOn(b.path, a.end.pos)
          return at.dist <= PASS_RADIUS_M && at.along < b.path.cumulative.at(-1)! - PASS_RADIUS_M
        }),
    )
    const labels = new Set(ends.map((c) => terminalLabel(c.end.name)))
    return labels.size === 1 ? [...labels][0]! : null
  }
  const memo = new Map<string, string | null>()
  return (route, direction, memberIds) => {
    const key = `${route}|${direction}|${memberIds.join(',')}`
    if (!memo.has(key)) memo.set(key, find(route, direction, memberIds))
    return memo.get(key)!
  }
}
