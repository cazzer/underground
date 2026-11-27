import { useMemo } from 'react'
import { drawnBoardStop } from '../lib/boardView'
import { drawnExitStop } from '../lib/exitView'
import { stationOfStop } from '../lib/live/arrivals'
import type { Network } from '../lib/network'
import { placeEndsOf, placeWalkSpan, type PlaceEnd, type PlaceEnds, type PlaceWalkSpan } from '../lib/placeWalk'
import type { Ground } from '../lib/projection'
import type { TripEnd, TripPlaces } from '../lib/trip'
import { stopStations } from '../lib/tripSpans'
import { plannable, tripKey, type TripEnds, type TripPlanState } from '../lib/tripView'
import type { TripJourney } from '../lib/route/plan'
import { interiorIdOf, type IndexLoad } from './interiorLoad'
import type { TripBoard } from './useTripBoard'
import type { TripExit } from './useTripExit'
import { useStationWalkLoad, type WalkLoad } from './useStationWalk'

/** What the trip holds that the place walks read (a subset of `useTrip()`). */
export interface PlaceWalkTrip {
  open: boolean
  ends: TripEnds
  places: TripPlaces
  plan: TripPlanState
  /** The journey the map draws. */
  selectedJourney: TripJourney | null
  /** The end whose station came from the location fix and was never chosen. */
  fixEnd: TripEnd | null
}

/** The selected journey while the trip panel is open with a ready plan for the current ends; null otherwise. */
function readyJourney({ open, ends, plan, selectedJourney }: PlaceWalkTrip): TripJourney | null {
  return open && plannable(ends) && plan.status === 'ready' && plan.key === tripKey(ends.from, ends.to) ? selectedJourney : null
}

const keyOf = (e: PlaceEnd | null): string => (e === null ? '-' : `${e.stop}@${e.place.x},${e.place.z}`)

/**
 * The ends that get a walk (`placeEndsOf`): the trip panel open with a ready plan for the current ends, a searched place
 * on the end (never the location fix: "My location" has no point, and an end filled from the fix is skipped) and the
 * selected journey reaching that end at a station of its own complex. Keeps its identity while those stay the same, so a
 * replan or a poll that leaves them alone loads and draws nothing again.
 */
export function usePlaceEnds(network: Network, trip: PlaceWalkTrip): PlaceEnds {
  const stops = useMemo(() => stopStations(network.stations), [network])
  const next = placeEndsOf({
    journey: readyJourney(trip),
    ends: trip.ends,
    places: trip.places,
    fixEnd: trip.fixEnd,
    stops,
    leadOf: (id) => network.stationById.get(id)?.leadId ?? id,
  })
  const key = `${keyOf(next.from)}|${keyOf(next.to)}`
  // `next` is read through `key`: the same stops and points are the same ends.
  return useMemo(() => next, [key])
}

export interface PlaceWalkGraphs {
  from: WalkLoad | null
  to: WalkLoad | null
}

/**
 * The walk graph of each place end's journey station (`useStationWalkLoad`), nothing for an end with no place.
 *
 * Privacy: the shard request names its station to the static host. The station is the one the journey reaches the end
 * at, in the complex of an end the visitor picked from a place they searched: not the nearest station to the location
 * fix (no fix end, no "My location" end), and never the place's own point, which stays in memory.
 */
export function usePlaceWalkGraphs(ends: PlaceEnds): PlaceWalkGraphs {
  const from = useStationWalkLoad(ends.from?.stationId ?? null)
  const to = useStationWalkLoad(ends.to?.stationId ?? null)
  return useMemo(() => ({ from: ends.from ? from : null, to: ends.to ? to : null }), [ends, from, to])
}

interface PlaceWalkSpansInput {
  ends: PlaceEnds
  graphs: PlaceWalkGraphs
  trip: PlaceWalkTrip
  fromStations: ReadonlySet<string>
  index: IndexLoad
  exit: TripExit | null
  board: TripBoard | null
}

export interface PlaceWalks {
  /** The walks that have settled, To's then From's, in the direction walked. */
  placeWalks: readonly PlaceWalkSpan[]
  /** Where the places are, whatever their walks' state. */
  places: readonly Ground[]
}

const NO_WALKS: PlaceWalks = { placeWalks: [], places: [] }

/** Whether the journey's stop has an interior: null while the index loads (nothing is known), false with no stop or on a failed index. */
function viaInterior(stop: string | null, index: IndexLoad): boolean | null {
  if (stop === null || index.status === 'error') return false
  return index.status === 'loading' ? null : interiorIdOf(stationOfStop(stop), index) !== null
}

/**
 * The walk to draw at each place end (`placeWalkSpan`): through the station's interior when the journey has a way out (To)
 * or in (From) there, whose chosen exit or entrance the walk joins, else from the station's point. A walk is left out
 * while an input it reads is settling (the graph, the index, the interior's choice), so it never draws straight and swaps.
 */
export function usePlaceWalkSpans({ ends, graphs, trip, fromStations, index, exit, board }: PlaceWalkSpansInput): PlaceWalks {
  const journey = readyJourney(trip)
  const exitStop = journey ? drawnExitStop(journey) : null
  const boardStop = journey ? drawnBoardStop(journey, fromStations) : null
  const toVia = viaInterior(exitStop, index)
  const fromVia = viaInterior(boardStop, index)
  return useMemo(() => {
    if (ends.from === null && ends.to === null) return NO_WALKS
    const spans: PlaceWalkSpan[] = []
    const add = (end: TripEnd, e: PlaceEnd | null, graph: WalkLoad | null, via: boolean | null, source: TripExit | TripBoard | null): void => {
      if (e === null || graph === null) return
      const choice = source === null ? undefined : source.drawn
      const s = placeWalkSpan({ end, place: e, viaInterior: via, interiorOrigin: source?.origin ?? null, choice, graph })
      if (s !== 'pending') spans.push(s)
    }
    add('to', ends.to, graphs.to, toVia, exit)
    add('from', ends.from, graphs.from, fromVia, board)
    return { placeWalks: spans, places: [ends.to, ends.from].flatMap((e) => (e === null ? [] : [e.place])) }
  }, [ends, graphs, toVia, fromVia, exit, board])
}
