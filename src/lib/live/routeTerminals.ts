import type { Direction, RouteId } from '../../data/schema'
import type { Ground } from '../projection'
import type { Station } from '../network'

/** The part of a drawn shape a terminal is read from. */
export interface TerminalShape {
  routeId: RouteId
  direction: Direction
  primary: boolean
  points: readonly Ground[]
}

/** The name a train of `route` going `direction` is bound for ("Flushing", "8 Av"), or null when it can't be found. */
export type TerminalOf = (route: RouteId, direction: Direction) => string | null

/**
 * "Flushing-Main St" is "Flushing", "Van Cortlandt Park-242 St" is "Van Cortlandt Park"; a street-number first part
 * gives way to the place after it ("34 St-Hudson Yards" is "Hudson Yards"); a name with no hyphen stays whole ("8 Av").
 */
export function terminalLabel(stationName: string): string {
  const [first = stationName, second] = stationName.split('-')
  return /^\d+ (St|Av)$/.test(first) && second !== undefined && !/^\d/.test(second) ? second : first
}

/**
 * Where each route's trains end up, from data loaded at startup and nothing else: the last point of the route's
 * primary shape for that direction (the most-used one), then the nearest station that route serves. No trip index,
 * which loads only with the live feed, and no fetch. Answers are memoised per route and direction.
 */
export function terminalsOf(shapes: readonly TerminalShape[], stations: readonly Station[]): TerminalOf {
  const memo = new Map<string, string | null>()
  const find = (route: RouteId, direction: Direction): string | null => {
    const shape = shapes.find((s) => s.routeId === route && s.direction === direction && s.primary)
    const end = shape?.points.at(-1)
    if (!end) return null
    let best: Station | null = null
    let bestD = Infinity
    for (const s of stations) {
      if (!s.routeIds.includes(route)) continue
      const d = (s.pos.x - end.x) ** 2 + (s.pos.z - end.z) ** 2
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best ? terminalLabel(best.name) : null
  }
  return (route, direction) => {
    const key = `${route}|${direction}`
    if (!memo.has(key)) memo.set(key, find(route, direction))
    return memo.get(key)!
  }
}
