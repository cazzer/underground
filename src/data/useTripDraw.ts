import type { EneInput } from '../lib/live/eneJoin'
import type { Network, ShapePath } from '../lib/network'
import type { PlaceWalkInfos } from '../lib/placeWalk'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
import type { TripEnd, TripPlaces } from '../lib/trip'
import type { TripSelection } from '../lib/tripSelection'
import type { TripEnds, TripPlanState } from '../lib/tripView'
import type { TripJourney } from '../lib/route/plan'
import type { IndexLoad } from './interiorLoad'
import { usePlaceEnds, usePlaceWalkGraphs, usePlaceWalkSpans } from './usePlaceWalks'
import { useTripBoard, type TripBoard } from './useTripBoard'
import { useTripExit, type TripExit } from './useTripExit'
import { useTripRoute } from './useTripRoute'

interface TripDrawInput {
  network: Network
  /** The drawn shapes (banded once the bands arrive). */
  paths: readonly ShapePath[]
  /** The parts of `useTrip()` the map's trip drawing reads. */
  trip: {
    open: boolean
    ends: TripEnds
    places: TripPlaces
    plan: TripPlanState
    selection: TripSelection
    selectedJourney: TripJourney | null
    fixEnd: TripEnd | null
  }
  index: IndexLoad
  ene: EneInput
  nowS: number
  /** The From station and its complex's other members. */
  fromStations: ReadonlySet<string>
}

export interface TripDraw {
  /** The way out at the To station, drawn and named in the panel (useTripExit). */
  exit: TripExit | null
  /** The way in at the From station (useTripBoard). */
  board: TripBoard | null
  /** The selected journey on the map: its rides, walks (between stations and to and from the searched places) and marks. */
  route: TripRouteDraw | null
  /** The settled walks to and from the ends' searched places in the panel's words (the drawn journey's). */
  placeWalks: PlaceWalkInfos
}

/**
 * The map's drawing of the selected trip, in the order it depends on itself (a6m): which ends have a searched place
 * and their stations' walk graphs, then the way out and in chosen for the walks to and from those places, then the
 * walks themselves, then the route that draws them. The exit and the board are chosen only once the visitor chose
 * their end (an end filled from the location fix waits for a focus or pick), and the place walks only for an end set
 * from a searched place (see `usePlaceEnds`): the location fix is never read here.
 */
export function useTripDraw({ network, paths, trip, index, ene, nowS, fromStations }: TripDrawInput): TripDraw {
  const { open, ends, plan, selection, selectedJourney, fixEnd } = trip
  const placeEnds = usePlaceEnds(network, trip)
  const graphs = usePlaceWalkGraphs(placeEnds)
  const exit = useTripExit({
    open,
    ends,
    plan,
    index,
    ene,
    nowS,
    selected: selectedJourney,
    allowed: fixEnd !== 'to',
    destination: placeEnds.to?.place ?? null,
    walk: graphs.to,
  })
  const board = useTripBoard({
    open,
    ends,
    plan,
    index,
    ene,
    nowS,
    selected: selectedJourney,
    fromStations,
    allowed: fixEnd !== 'from',
    origin: placeEnds.from?.place ?? null,
    walk: graphs.from,
  })
  const { placeWalks, places, infos } = usePlaceWalkSpans({ ends: placeEnds, graphs, trip, fromStations, index, exit, board })
  const route = useTripRoute({ network, paths, open, plan, selection, journey: selectedJourney, placeWalks, places })
  return { exit, board, route, placeWalks: infos }
}
