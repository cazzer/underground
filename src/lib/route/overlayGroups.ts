/** The scheduled timetable regrouped for the realtime overlay: one group per stop sequence, lanes merged. Pure. */
import type { Direction, RouteId, StopId } from '../../data/schema'
import { makePatterns, type TripInput } from './patterns'
import type { Pattern, StopIndex, Timetable } from './types'

/** Key prefix of the patterns the overlay adds for trips that fit no scheduled stop sequence. */
export const ONE_OFF_PREFIX = 'rt:'

export interface Row extends TripInput {
  group: Group
  /** Replaced by a realtime trip, or cancelled. */
  removed: boolean
}

/** All the FIFO lanes ("key", "key#1", ...) of one stop sequence, and what the overlay changes in it. */
export interface Group {
  /** The lanes' key without the "#j" suffix. */
  key: string
  stops: Int32Array
  stopIds: StopId[]
  direction: Direction
  /** Routes of the scheduled trips; never grows with the overlay's own trips. */
  routes: Set<RouteId>
  /** The scheduled trips; `arr` and `dep` are views of their lane. */
  rows: Row[]
  /** Realtime trips to add. */
  added: TripInput[]
  lanes: readonly Pattern[]
  changed: boolean
}

const baseKey = (key: string): string => key.replace(/#\d+$/, '')

function directionOf(stopIds: readonly StopId[]): Direction {
  const d = stopIds[stopIds.length - 1]!.slice(-1)
  if (d !== 'N' && d !== 'S') throw new Error(`stop id "${stopIds[stopIds.length - 1]}" has no direction`)
  return d
}

export const oneOffKey = (stopIds: readonly StopId[]): string => `${ONE_OFF_PREFIX}${stopIds.join(' ')}`

/** An empty group for a reroute; `key` is `rt:` plus its stop ids. */
export function oneOffGroup(index: StopIndex, stopIds: readonly StopId[]): Group {
  return {
    key: oneOffKey(stopIds),
    stops: Int32Array.from(stopIds, (id) => index.stopOf.get(id)!),
    stopIds: [...stopIds],
    direction: directionOf(stopIds),
    routes: new Set(),
    rows: [],
    added: [],
    lanes: [],
    changed: false,
  }
}

/**
 * Groups `tt`'s patterns by key without the "#j" lane suffix. Throws when `tt` already carries realtime trips
 * (an overlay of an overlay) or when lanes of one key disagree on their stops: both are programmer errors.
 */
export function groupPatterns(tt: Timetable): Map<string, Group> {
  const groups = new Map<string, Group>()
  const { stopIds } = tt.stops
  for (const pat of tt.patterns) {
    if (pat.key.startsWith(ONE_OFF_PREFIX) || pat.live.includes(1)) throw new Error('overlay needs the scheduled timetable')
    const key = baseKey(pat.key)
    let group = groups.get(key)
    if (!group) {
      const ids = Array.from(pat.stops, (s) => stopIds[s]!)
      group = {
        key,
        stops: pat.stops,
        stopIds: ids,
        direction: directionOf(ids),
        routes: new Set(),
        rows: [],
        added: [],
        lanes: [],
        changed: false,
      }
      groups.set(key, group)
    } else if (group.stops.length !== pat.stops.length || group.stops.some((s, i) => s !== pat.stops[i])) {
      throw new Error(`pattern lanes of ${key} have different stops`)
    }
    group.lanes = [...group.lanes, pat]
    const n = pat.stops.length
    pat.tripIds.forEach((id, i) => {
      group.routes.add(pat.routeIds[i]!)
      group.rows.push({
        id,
        routeId: pat.routeIds[i]!,
        arr: pat.arr.subarray(i * n, (i + 1) * n),
        dep: pat.dep.subarray(i * n, (i + 1) * n),
        group,
        removed: false,
      })
    })
  }
  return groups
}

/**
 * The patterns after the overlay: a changed group is rebuilt from its kept rows and added trips (lanes re-split
 * by `makePatterns`), an unchanged one keeps its lane objects. Original groups first, then the reroutes by key.
 */
export function rebuildPatterns(index: StopIndex, groups: ReadonlyMap<string, Group>): Pattern[] {
  const all = [...groups.values()]
  const ordered = [
    ...all.filter((g) => !g.key.startsWith(ONE_OFF_PREFIX)),
    ...all.filter((g) => g.key.startsWith(ONE_OFF_PREFIX)).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
  ]
  return ordered.flatMap((g) => {
    if (!g.changed) return [...g.lanes]
    const trips = [...g.rows.filter((r) => !r.removed), ...g.added]
    return makePatterns(index, { key: g.key, stops: g.stopIds, trips })
  })
}
