/**
 * The walk between a trip end's searched place and the station the journey reaches that end at (a6m): at To, from the
 * chosen exit (or the station) along the streets to the place; at From, from the place to the chosen entrance (or the
 * station). Pure; no fetch, React or storage.
 *
 * Privacy: an end gets a walk only from a place the visitor searched (`TripPlace.ground`), never the location fix
 * ("My location" has no ground, and `fixEnd` is skipped too), and only at a station of the end's own complex, so the
 * walk shard it loads names a station the visitor chose.
 */
import type { StationId, StopId } from '../data/schema'
import type { WalkGraph } from '../data/walkSchema'
import type { BoardChoice, ExitChoice } from './exitChoice'
import type { Station } from './network'
import type { Ground } from './projection'
import type { TripJourney } from './route/plan'
import type { TripEnd, TripPlaces } from './trip'
import { walkPathIn } from './tripWalkPaths'
import type { TripEnds } from './tripView'

/** One end's walk: the searched place, and the journey station it is walked to or from. */
export interface PlaceEnd {
  place: Ground
  stationId: StationId
  /** The journey's boarding (From) or alighting (To) stop at that station, where a path inside it starts or ends. */
  stop: StopId
  /** The station's point. */
  point: Ground
}

export type PlaceEnds = Record<TripEnd, PlaceEnd | null>

export const NO_PLACE_ENDS: PlaceEnds = { from: null, to: null }

export interface PlaceEndsInput {
  /** The journey the map draws; null with none (no plan for these ends, the panel closed). */
  journey: TripJourney | null
  ends: TripEnds
  places: TripPlaces
  /** The end whose station came from the location fix and was never chosen (`TripValue.fixEnd`). */
  fixEnd: TripEnd | null
  stops: ReadonlyMap<StopId, Pick<Station, 'id' | 'leadId' | 'pos'>>
  /** An end's station to its complex's lead. */
  leadOf: (id: StationId) => StationId
}

/** The journey's boarding stop (From) or last alighting stop (To): the first or last leg's stop, a walk's included. */
function journeyStop(journey: TripJourney, end: TripEnd): StopId | null {
  const leg = end === 'from' ? journey.legs[0] : journey.legs.at(-1)
  if (!leg) return null
  if (leg.kind === 'ride') return end === 'from' ? leg.boardStop : leg.alightStop
  return end === 'from' ? leg.fromStop : leg.toStop
}

/**
 * Which ends get a walk, with the station each reaches: an end with a searched place (a point, not "My location"),
 * not filled from the fix, on a journey whose first (From) or last (To) stop stands at a station of the end's own
 * complex. Anything else is null, so nothing about a place is loaded or drawn for it.
 */
export function placeEndsOf({ journey, ends, places, fixEnd, stops, leadOf }: PlaceEndsInput): PlaceEnds {
  if (journey === null) return NO_PLACE_ENDS
  const one = (end: TripEnd): PlaceEnd | null => {
    const place = places[end]?.ground ?? null
    const endStation = ends[end]
    if (place === null || endStation === null || fixEnd === end) return null
    const stop = journeyStop(journey, end)
    const station = stop === null ? undefined : stops.get(stop)
    if (stop === null || !station || station.leadId !== leadOf(endStation)) return null
    return { place, stationId: station.id, stop, point: { x: station.pos.x, z: station.pos.z } }
  }
  const from = one('from')
  const to = one('to')
  return from === null && to === null ? NO_PLACE_ENDS : { from, to }
}

/** A place walk in the direction it is walked: `from` to `to`, along `path` when found, else the straight line. */
export interface PlaceWalkSpan {
  end: TripEnd
  from: Ground
  to: Ground
  path?: readonly Ground[]
}

export interface PlaceWalkInput {
  end: TripEnd
  place: PlaceEnd
  /** Whether the journey's stop here has an interior (a path inside the station, whose exit or entrance the walk joins); null while the index loads. */
  viaInterior: boolean | null
  /** The interior's scene origin, for the choice's exit point; null with no interior. */
  interiorOrigin: Ground | null
  /** The way out (To) or in (From) chosen for this place: undefined while it is not computed yet, null when there is none. */
  choice: ExitChoice | BoardChoice | null | undefined
  /** The station's walk graph load. */
  graph: { graph: WalkGraph | null; settled: boolean }
}

/** A straight span, or one along `path` (the street path in walking order). */
function span(end: TripEnd, from: Ground, to: Ground, path?: readonly Ground[]): PlaceWalkSpan {
  return path ? { end, from, to, path } : { end, from, to }
}

/**
 * The walk to draw for one end, or `'pending'` while an input it reads has not settled (the walk graph, the interior
 * index, the interior's choice), so it never draws straight and then swaps. Through an interior the choice's own walk
 * is reused (its street points, or the straight line from the exit or entrance point when the place is past the graph);
 * else the station point is routed over the graph, else it is a straight dash. A From walk runs place to station.
 */
export function placeWalkSpan({ end, place, viaInterior, interiorOrigin, choice, graph }: PlaceWalkInput): PlaceWalkSpan | 'pending' {
  if (!graph.settled || viaInterior === null) return 'pending'
  const toPlace = end === 'to'
  if (viaInterior) {
    if (choice === undefined) return 'pending'
    if (choice !== null && choice.walk !== null && interiorOrigin !== null) {
      const { walk } = choice
      if (walk.kind === 'route') return span(end, walk.points[0]!, walk.points.at(-1)!, walk.points)
      const at = { x: interiorOrigin.x + choice.exit.point[0], z: interiorOrigin.z + choice.exit.point[1] }
      return toPlace ? span(end, at, place.place) : span(end, place.place, at)
    }
  }
  const station = place.point
  const found = graph.graph ? walkPathIn(graph.graph, station, place.place) : null
  const path = found?.ok ? found.path : undefined
  if (toPlace) return span(end, station, place.place, path)
  return span(end, place.place, station, path ? [...path].reverse() : undefined)
}
