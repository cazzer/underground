import type { RouteId, ShapeId, StationId, TripPattern } from '../../data/schema'
import { routeSpokenName } from '../labels'
import type { LiveTrip } from '../realtime/prepareTrips'
import { stationOfStop } from './arrivals'
import { trainRouteId } from './trainRoute'

/** What the train panel and the "no longer tracked" notice say about a train. */
export interface TrainSummary {
  /** The route the train is drawn as; null if neither the feed's route nor the shape's is known. */
  routeId: RouteId | null
  /** Spoken route name ("F express"); null with routeId. */
  routeName: string | null
  /** Name of the last stop of its pattern, else of the last stop the feed predicts; null if unknown. */
  headsign: string | null
}

export function trainSummary(
  trip: Pick<LiveTrip, 'trip' | 'shapeId'>,
  routeById: ReadonlyMap<RouteId, { shortName: string }>,
  patterns: Readonly<Record<ShapeId, TripPattern>>,
  stationName: (id: StationId) => string | undefined,
): TrainSummary {
  const routeId = trainRouteId(trip, routeById, patterns)
  const route = routeId === null ? undefined : routeById.get(routeId)
  // The feed's arrivals stop at its horizon, so they name the terminal only when the pattern is unknown.
  const terminal = patterns[trip.shapeId]?.stops.at(-1) ?? trip.trip.arrivals.at(-1)?.[0]
  return {
    routeId: route ? routeId : null,
    routeName: route ? routeSpokenName(route.shortName) : null,
    headsign: (terminal !== undefined && stationName(stationOfStop(terminal))) || null,
  }
}

/** "7 train to Flushing-Main St", "7 train", or null when the route is unknown. */
function trainName(summary: TrainSummary | null): string | null {
  if (!summary?.routeName) return null
  return summary.headsign ? `${summary.routeName} train to ${summary.headsign}` : `${summary.routeName} train`
}

/** The notice shown when a selected train drops out of the feed. */
export function goneNotice(summary: TrainSummary | null): string {
  const name = trainName(summary)
  return name ? `The ${name} is no longer tracked.` : "Lost this train's live position."
}

/** What a screen reader hears when a train is picked. */
export function selectedAnnouncement(summary: TrainSummary | null): string {
  return `Selected ${trainName(summary) ?? 'train'}.`
}
