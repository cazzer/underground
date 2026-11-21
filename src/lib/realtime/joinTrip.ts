import { parseTripId, shapeIdOf, tripKey } from '../../data/codec'
import type { ShapeId } from '../../data/schema'
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

/** Several shapes can share a key: prefer ones that call at the train's stop, then the route's primary, then the first. */
function pickShape(shapes: readonly ShapeId[], stopId: string | null, lookup: TripLookup): ShapeId {
  const calling = stopId ? shapes.filter((s) => lookup.patterns[s]?.stops.includes(stopId)) : []
  const pool = calling.length > 0 ? calling : shapes
  const isPrimary = (s: ShapeId): boolean => {
    const pattern = lookup.patterns[s]
    return !!pattern && lookup.primary.get(primaryKey(pattern.routeId, pattern.direction)) === s
  }
  return pool.find(isPrimary) ?? pool[0]!
}

export function joinTrip(
  trip: Pick<RealtimeTrip, 'tripId' | 'route' | 'startDate' | 'stopId'>,
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
  const today = nyDate(now)
  const dates = trip.startDate ? [trip.startDate] : [today, addDays(today, -1)]
  for (const date of dates) {
    const candidates = [
      { day: date, origin: p.origin },
      { day: addDays(date, -1), origin: p.origin + ORIGIN_UNITS_PER_DAY },
    ]
    for (const { day, origin } of candidates) {
      for (const service of servicesOn(day, lookup.calendar, lookup.exceptions)) {
        for (const route of routes) {
          const shapes = lookup.keys.get(service)?.get(tripKey(origin, route, p.direction))
          if (shapes) return { matched: true, shapeId: pickShape(shapes, trip.stopId, lookup), stage: 'tripKey' }
        }
      }
    }
  }

  const primary =
    lookup.primary.get(primaryKey(trip.route, p.direction)) ?? lookup.primary.get(primaryKey(p.route, p.direction))
  if (primary) return { matched: true, shapeId: primary, stage: 'primary' }
  return { matched: false, reason: 'unknown-route' }
}
