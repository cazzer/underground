import type { RouteId, ShapeId, TripPattern } from '../../data/schema'
import type { LiveTrip } from '../realtime/prepareTrips'

/**
 * The route a dot is colored by: the feed's own route when it is a known route (routes.json has
 * the variants FX, 6X, 7X, GS, FS, H and SI), else the joined shape's route; null if neither is known.
 */
export function trainRouteId(
  trip: Pick<LiveTrip, 'trip' | 'shapeId'>,
  routeById: ReadonlyMap<RouteId, unknown>,
  patterns: Readonly<Record<ShapeId, TripPattern>>,
): RouteId | null {
  if (routeById.has(trip.trip.route)) return trip.trip.route
  const fromShape = patterns[trip.shapeId]?.routeId
  return fromShape !== undefined && routeById.has(fromShape) ? fromShape : null
}
