import { parseTripId, shapeIdOf, tripKey, type ParsedTripId } from '../../data/codec'
import type { Direction, ServiceId, ShapeId } from '../../data/schema'
import type { RealtimeTrip } from '../../data/realtime'
import { addDays, nyDate, servicesOn } from './serviceDate'
import { primaryKey, type TripLookup } from './tripLookup'

/** Origin times are hundredths of a minute; a static after-midnight trip is 24:xx on the previous service day. */
export const ORIGIN_UNITS_PER_DAY = 144_000

/** path: the id's own shape; tripKey: origin time on a running service; primary: route+direction fallback. */
export type JoinStage = 'path' | 'tripKey' | 'primary'
export type JoinResult =
  | { matched: true; shapeId: ShapeId; stage: JoinStage }
  | { matched: false; reason: 'unparseable-id' | 'unknown-route' }

/** Keeps the shapes that satisfy `keep`, or all of them when none do. */
function narrow(shapes: readonly ShapeId[], keep: (s: ShapeId) => boolean): readonly ShapeId[] {
  const kept = shapes.filter(keep)
  return kept.length > 0 ? kept : shapes
}

/**
 * Several shapes can share a key (an N and a W shape, or two paths of one route). Prefer the train's own
 * route, then shapes calling at its stop, then the primary shape of the route that produced the key hit.
 */
function pickShape(
  candidates: readonly ShapeId[],
  trip: Pick<RealtimeTrip, 'route' | 'stopId'>,
  routeOfHit: string,
  direction: Direction,
  lookup: TripLookup,
): ShapeId {
  let pool = narrow(candidates, (s) => lookup.patterns[s]?.routeId === trip.route)
  const { stopId } = trip
  if (stopId) pool = narrow(pool, (s) => lookup.patterns[s]?.stops.includes(stopId) ?? false)
  const primary = lookup.primary.get(primaryKey(routeOfHit, direction))
  return pool.find((s) => s === primary) ?? pool[0]!
}

/**
 * The fallback shape for a trip with no usable id: of the route's patterns in this direction, the one
 * calling at the train's stop that covers the most of its predicted stops. Ties go to the shape the trip had
 * last poll (so it doesn't flap), then to the primary.
 */
function bestPattern(
  primary: ShapeId,
  route: string,
  direction: Direction,
  trip: Pick<RealtimeTrip, 'stopId'> & Partial<Pick<RealtimeTrip, 'arrivals'>>,
  lookup: TripLookup,
  previous: ShapeId | undefined,
): ShapeId {
  const { stopId, arrivals } = trip
  if (!arrivals || arrivals.length === 0) return primary
  const all = lookup.patternsOf.get(primaryKey(route, direction)) ?? [primary]
  const calling = stopId ? all.filter((s) => lookup.patterns[s]?.stops.includes(stopId)) : all
  let best = primary
  let bestCovered = -1
  for (const shapeId of calling.length > 0 ? calling : all) {
    const stops = lookup.patterns[shapeId]!.stops
    const covered = arrivals.reduce((n, a) => n + (stops.includes(a[0]) ? 1 : 0), 0)
    const rank = (s: ShapeId) => (s === previous ? 2 : s === primary ? 1 : 0)
    if (covered > bestCovered || (covered === bestCovered && rank(shapeId) > rank(best))) {
      best = shapeId
      bestCovered = covered
    }
  }
  return best
}

/** The routes a trip id can be keyed under: the id's own, then the feed's when it differs (W runs on "N"). */
function routesOf(p: ParsedTripId, route: string): string[] {
  return p.route === route ? [p.route] : [p.route, route]
}

export interface ScheduledMatch {
  /** Service day (YYYYMMDD) the origin counts from: the trip's start date, or the day before for a 24:xx static origin. */
  day: string
  service: ServiceId
  /** Hundredths of a minute after `day`'s service-day start (past 144000 for 24:xx). */
  origin: number
  /** Route of the key that hit (the id's route, else the feed's). */
  route: string
  shapes: readonly ShapeId[]
}

/**
 * The scheduled trips a realtime id's origin time names: the first (date, service, route) whose key
 * `origin_route..direction` is in the trip index, else null. Shared by `joinTrip` and the router overlay.
 */
export function matchScheduled(
  trip: Pick<RealtimeTrip, 'route' | 'startDate'>,
  p: ParsedTripId,
  lookup: TripLookup,
  now: number,
): ScheduledMatch | null {
  const routes = routesOf(p, trip.route)
  let dates: string[]
  if (trip.startDate) dates = [trip.startDate]
  else {
    const today = nyDate(now)
    dates = [today, addDays(today, -1)]
  }
  for (const date of dates) {
    const candidates = [
      { day: date, origin: p.origin },
      { day: addDays(date, -1), origin: p.origin + ORIGIN_UNITS_PER_DAY },
    ]
    for (const { day, origin } of candidates) {
      for (const service of servicesOn(day, lookup.calendar, lookup.exceptions)) {
        for (const route of routes) {
          const shapes = lookup.keys.get(service)?.get(tripKey(origin, route, p.direction))
          if (shapes) return { day, service, origin, route, shapes }
        }
      }
    }
  }
  return null
}

export function joinTrip(
  trip: Pick<RealtimeTrip, 'tripId' | 'route' | 'startDate' | 'stopId'> & Partial<Pick<RealtimeTrip, 'arrivals'>>,
  lookup: TripLookup,
  now: number,
  /** The shape this trip was placed on last poll, to break ties between equally good fallback shapes. */
  previousShape?: ShapeId,
): JoinResult {
  const p = parseTripId(trip.tripId)
  if (!p) return { matched: false, reason: 'unparseable-id' }

  if (p.path !== '') {
    const shapeId = shapeIdOf(p)
    if (lookup.patterns[shapeId]) return { matched: true, shapeId, stage: 'path' }
  }

  const hit = matchScheduled(trip, p, lookup, now)
  if (hit) return { matched: true, shapeId: pickShape(hit.shapes, trip, hit.route, p.direction, lookup), stage: 'tripKey' }

  for (const route of routesOf(p, trip.route).toReversed()) {
    const primary = lookup.primary.get(primaryKey(route, p.direction))
    if (primary) return { matched: true, shapeId: bestPattern(primary, route, p.direction, trip, lookup, previousShape), stage: 'primary' }
  }
  return { matched: false, reason: 'unknown-route' }
}
