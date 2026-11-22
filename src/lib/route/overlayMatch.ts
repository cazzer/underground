/** Pairs realtime trips with their scheduled twins. Pure. Feeds are ignored on purpose: a twin is the same route,
 *  direction and first departure, wherever the trip came in. */
import type { Direction, RouteId } from '../../data/schema'
import type { Group, Row } from './overlayGroups'
import { findRun } from './overlayRows'

/** A trip id's origin differs from the timetable's first departure by up to 90 s on 240 trips (2q7.4). */
export const TWIN_TOLERANCE_S = 120

export interface TwinQuery {
  /** Routes the trip's key named (a W trip's key may be an N shape's). */
  routes: ReadonlySet<RouteId>
  direction: Direction
  /** The trip id's origin, in day seconds. */
  originS: number
  /** The predicted stops, as stop indices. */
  run: Int32Array
}

interface Candidate {
  query: number
  row: Row
  order: number
  /** 0 when the row's stop sequence contains the predicted run, else 1. */
  fit: number
  gap: number
}

interface Entry {
  row: Row
  order: number
}

const rowKey = (route: RouteId, direction: Direction): string => `${route}|${direction}`

/** Index of the first entry whose first departure is at least `t`. */
function lowerBound(list: readonly Entry[], t: number): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid]!.row.dep[0]! < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * For each query, the scheduled row it replaces, or null. A row is a candidate when it is on one of the
 * query's routes and direction and departs within TWIN_TOLERANCE_S of the origin. Pairs are taken greedily,
 * one to one: a row whose stop sequence holds the run first, then the nearest departure, then the earlier query,
 * then the earlier row.
 */
export function assignTwins(groups: Iterable<Group>, queries: readonly (TwinQuery | null)[]): (Row | null)[] {
  const byRoute = new Map<string, Entry[]>()
  let order = 0
  for (const group of groups) {
    for (const row of group.rows) {
      const key = rowKey(row.routeId, group.direction)
      const list = byRoute.get(key)
      const entry = { row, order: order++ }
      if (list) list.push(entry)
      else byRoute.set(key, [entry])
    }
  }
  for (const list of byRoute.values()) list.sort((a, b) => a.row.dep[0]! - b.row.dep[0]! || a.order - b.order)

  const candidates: Candidate[] = []
  queries.forEach((q, query) => {
    if (!q) return
    for (const route of q.routes) {
      const list = byRoute.get(rowKey(route, q.direction))
      if (!list) continue
      for (let i = lowerBound(list, q.originS - TWIN_TOLERANCE_S); i < list.length; i++) {
        const { row, order: ord } = list[i]!
        const gap = Math.abs(row.dep[0]! - q.originS)
        if (row.dep[0]! - q.originS > TWIN_TOLERANCE_S) break
        candidates.push({ query, row, order: ord, fit: findRun(row.group.stops, q.run) >= 0 ? 0 : 1, gap })
      }
    }
  })
  candidates.sort((a, b) => a.fit - b.fit || a.gap - b.gap || a.query - b.query || a.order - b.order)

  const twins: (Row | null)[] = queries.map(() => null)
  const taken = new Set<Row>()
  for (const c of candidates) {
    if (twins[c.query] || taken.has(c.row)) continue
    twins[c.query] = c.row
    taken.add(c.row)
  }
  return twins
}
