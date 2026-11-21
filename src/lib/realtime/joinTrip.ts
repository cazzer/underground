import { parseTripId, shapeIdOf, tripKey } from '../../data/codec'
import type { Direction, ShapeId } from '../../data/schema'
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
 * calling at the train's stop that covers the most of its predicted stops. Ties go to the primary.
 */
function bestPattern(
  primary: ShapeId,
  route: string,
  direction: Direction,
  trip: Pick<RealtimeTrip, 'stopId'> & Partial<Pick<RealtimeTrip, 'arrivals'>>,
  lookup: TripLookup,
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
    if (covered > bestCovered || (covered === bestCovered && shapeId === primary)) {
      best = shapeId
      bestCovered = covered
    }
  }
  return best
}

export function joinTrip(
  trip: Pick<RealtimeTrip, 'tripId' | 'route' | 'startDate' | 'stopId'> & Partial<Pick<RealtimeTrip, 'arrivals'>>,
  lookup: TripLookup,
  now: number,
): JoinResult {
  const p = parseTripId(trip.tripId)
  if (!p) return { matched: false, reason: 'unparseable-id' }

  if (p.path !== '') {
    const shapeId = shapeIdOf(p)
    if (lookup.patterns[shapeId]) return { matched: true, shapeId, stage: 'path' }
  }

  const routes = p.route === trip.route ? [p.route] : [p.route, trip.route]
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
          if (shapes) {
            return { matched: true, shapeId: pickShape(shapes, trip, route, p.direction, lookup), stage: 'tripKey' }
          }
        }
      }
    }
  }

  for (const route of routes.toReversed()) {
    const primary = lookup.primary.get(primaryKey(route, p.direction))
    if (primary) return { matched: true, shapeId: bestPattern(primary, route, p.direction, trip, lookup), stage: 'primary' }
  }
  return { matched: false, reason: 'unknown-route' }
}
