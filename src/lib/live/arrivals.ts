import { FEED_IDS, type RealtimeSnapshot } from '../../data/realtime'
import type { Direction, RouteId, StationId, StopId } from '../../data/schema'
import { ghostReason } from '../realtime/filters'
import { joinTrip } from '../realtime/joinTrip'
import type { TripLookup } from '../realtime/tripLookup'
import { trainRouteId } from './trainRoute'

/** Arrivals further out than this are not listed. */
export const ARRIVAL_WINDOW_S = 1800
/** Times listed per route, direction and destination. */
export const MAX_TIMES_PER_GROUP = 3
/** A train this far past its predicted time is still at the platform: "Now", not gone. */
export const PAST_GRACE_S = 30
/** Under this many seconds away reads "Now". */
export const NOW_UNDER_S = 30

export interface ArrivalGroup {
  routeId: RouteId
  direction: Direction
  /** Name of the trip's last stop. */
  headsign: string
  /** Predicted epoch seconds at this station, ascending; at most MAX_TIMES_PER_GROUP. */
  times: number[]
  /** `times[i]`'s trip as the map keys it (`${feed}:${tripId}`, the same as `LiveTrip.key`); same length and order. */
  tripKeys: string[]
}

/** What the station panel reads arrivals from: the latest snapshot, the clock to evaluate it on, and the join data. */
export interface ArrivalsSource {
  snapshot: RealtimeSnapshot
  offsetS: number
  lookup: TripLookup
  /** Consecutive failed polls. */
  failures: number
  /** Keys of the trips the map draws as trains this poll: only those can be selected from a row. */
  drawnKeys: ReadonlySet<string>
}

export interface ArrivalOptions {
  lookup: TripLookup
  routeById: ReadonlyMap<RouteId, unknown>
  /** Parent station id to its name. */
  stationName: (id: StationId) => string | undefined
}

/** Child stop ids are the station id plus the direction letter ("L08N"). */
export const stationOfStop = (stop: StopId): StationId => stop.slice(0, -1)
const directionOfStop = (stop: StopId): Direction => (stop.endsWith('N') ? 'N' : 'S')

/**
 * The next arrivals at `station`, grouped by route, direction and destination. A trip is kept unless it is
 * stale or has nothing ahead of it: the "unassigned" ghost rule is not applied, because a scheduled train
 * that has not been dispatched yet is still a real next arrival (at a terminal it is often the only one),
 * even though the map does not draw it. A trip that ends at this station is skipped: nobody boards it.
 *
 * The destination is the last stop of the pattern the trip joins to (the feed's own arrival list is cut at
 * 30 minutes, so its last stop is not the terminal). If the join fails, the last stop the feed predicts is
 * the best name left; when that is this station and the list runs to the horizon, the trip is kept, since
 * it was cut short rather than ending here.
 *
 * For a complex, `stops` is every member's and `memberIds` lists them: a trip is listed once, at its soonest member
 * stop, and one ending at any member is skipped.
 *
 * Groups are ordered by direction (north first, so rows stay put between polls), then soonest time.
 */
export function arrivalsAt(
  snapshot: RealtimeSnapshot,
  station: { id: StationId; stops: readonly StopId[]; memberIds?: readonly StationId[] },
  nowS: number,
  opts: ArrivalOptions,
): ArrivalGroup[] {
  const stops = new Set(station.stops)
  const members = new Set(station.memberIds ?? [station.id])
  const groups = new Map<string, ArrivalGroup>()

  for (const feed of FEED_IDS) {
    for (const trip of snapshot.feeds[feed].trips) {
      const here = trip.arrivals.filter(
        ([stop, t]) => stops.has(stop) && t >= nowS - PAST_GRACE_S && t <= nowS + ARRIVAL_WINDOW_S,
      )
      if (here.length === 0) continue
      if (ghostReason({ ...trip, assigned: true }, nowS)) continue

      const join = joinTrip(trip, opts.lookup, nowS)
      const shapeId = join.matched ? join.shapeId : ''
      const patternTerminal = opts.lookup.patterns[shapeId]?.stops.at(-1)
      const last = trip.arrivals.at(-1)
      const terminal = patternTerminal ?? last?.[0]
      if (terminal === undefined || last === undefined) continue
      // A trip whose last known stop is this station (any member of its complex) is skipped: nobody boards it here,
      // and a headsign naming this station would be wrong. That includes unjoined trips cut at the Worker horizon
      // (rare, and ~30 min out).
      if (members.has(stationOfStop(terminal))) continue
      const headsign = opts.stationName(stationOfStop(terminal))
      const routeId = trainRouteId({ trip, shapeId }, opts.routeById, opts.lookup.patterns)
      if (headsign === undefined || routeId === null) continue

      const [stop, time] = here.reduce((a, b) => (b[1] < a[1] ? b : a))
      const direction = directionOfStop(stop)
      const key = `${routeId}|${direction}|${headsign}`
      const group = groups.get(key)
      const tripKey = `${feed}:${trip.tripId}`
      if (group) {
        group.times.push(time)
        group.tripKeys.push(tripKey)
      } else groups.set(key, { routeId, direction, headsign, times: [time], tripKeys: [tripKey] })
    }
  }

  return [...groups.values()]
    .map(soonest)
    .sort((a, b) => a.direction.localeCompare(b.direction) || a.times[0]! - b.times[0]! || a.routeId.localeCompare(b.routeId) || a.headsign.localeCompare(b.headsign))
}

/** The group's soonest MAX_TIMES_PER_GROUP arrivals, times and trip keys kept in step. */
function soonest(g: ArrivalGroup): ArrivalGroup {
  const order = g.times.map((_, i) => i).sort((a, b) => g.times[a]! - g.times[b]!).slice(0, MAX_TIMES_PER_GROUP)
  return { ...g, times: order.map((i) => g.times[i]!), tripKeys: order.map((i) => g.tripKeys[i]!) }
}

/** What a row's button selects: the group's soonest arrival whose train the map draws, or null if none is. */
export function selectableArrival(group: ArrivalGroup, drawnKeys: ReadonlySet<string>): { tripKey: string; time: number } | null {
  const i = group.tripKeys.findIndex((key) => drawnKeys.has(key))
  return i < 0 ? null : { tripKey: group.tripKeys[i]!, time: group.times[i]! }
}

/**
 * Minutes away, the one rule both panels use: "Now" under 30 seconds (or already past), else the arrival's
 * clock minute minus the current one, never less than 1. Counting on the clock face keeps "1:50 · 6 min" and
 * "1:52 · 8 min" consistent with each other, and the two panels agree for the same train (New York is a whole
 * number of minutes from UTC, so epoch minutes are clock minutes).
 */
export function minutesAway(timeS: number, nowS: number): string {
  if (timeS - nowS < NOW_UNDER_S) return 'Now'
  return String(Math.max(1, Math.floor(timeS / 60) - Math.floor(nowS / 60)))
}

/** "4, 9, 15 min", or "Now, 6 min"; a lone "Now" has no unit. */
export function formatArrivalTimes(times: readonly number[], nowS: number): string {
  const parts = times.map((t) => minutesAway(t, nowS)).filter((p, i, all) => p !== 'Now' || i === all.indexOf('Now'))
  return parts.at(-1) === 'Now' ? parts.join(', ') : `${parts.join(', ')} min`
}
