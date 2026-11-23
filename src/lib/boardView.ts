/** Which journeys have a way in at the trip's From station: the stops their first trains leave from. Pure. */
import type { StationId, StopId } from '../data/schema'
import type { ExitLineView } from './exitView'
import { stationOfStop } from './live/arrivals'
import type { TripJourney } from './route/plan'

/** A stop some journeys board their first train at, and the trips they ride from there (in journey order). */
export interface FirstRideStop {
  stopId: StopId
  tripIds: string[]
}

/** What the trip panel has for a journey's way in: its line, or that the layout has no entry to the track (every
 *  entrance to that platform is exit-only, as at 302 and A03 uptown). */
export type BoardLine = { kind: 'path'; view: ExitLineView } | { kind: 'no-entrance' }

/** The way-in line's key: the journey's first ride and the station it boards at (one trip can be boarded at two
 *  stations by two journeys, only one of them at From). */
export function boardLineKey(tripId: string, stationId: StationId): string {
  return `${tripId}@${stationId}`
}

/**
 * The first ride's boarding stop of a journey that starts on a train at the From station (`fromStations`: the From
 * station and its complex's other members); null for a journey that walks to another station first, or has no ride.
 * That other station comes from the plan rather than the visitor, so it gets no way in.
 */
export function drawnBoardStop(journey: TripJourney, fromStations: ReadonlySet<StationId>): StopId | null {
  const first = journey.legs.find((l) => l.kind === 'ride')
  return first?.kind === 'ride' && fromStations.has(stationOfStop(first.boardStop)) ? first.boardStop : null
}

/** The distinct boarding stops (`drawnBoardStop`) of the journeys, in journey order, each with its first rides' trip ids. */
export function firstRideStops(journeys: readonly TripJourney[], fromStations: ReadonlySet<StationId>): FirstRideStop[] {
  const out: FirstRideStop[] = []
  for (const j of journeys) {
    const stopId = drawnBoardStop(j, fromStations)
    const first = j.legs.find((l) => l.kind === 'ride')
    if (stopId === null || first?.kind !== 'ride') continue
    const at = out.find((s) => s.stopId === stopId)
    if (at) {
      if (!at.tripIds.includes(first.tripId)) at.tripIds.push(first.tripId)
    } else out.push({ stopId, tripIds: [first.tripId] })
  }
  return out
}
