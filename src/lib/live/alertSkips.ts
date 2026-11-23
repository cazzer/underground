import type { AlertsSnapshot } from '../../data/realtime'
import type { Direction, RouteId, ShapeId, StationId, TripPattern } from '../../data/schema'
import type { Station } from '../network'
import type { LiveTrip } from '../realtime/prepareTrips'
import { ALERTS_MAX_AGE_S } from './alertJoin'
import { skipSetsOf, type RouteSkipSet } from './alertStations'
import { stationOfStop } from './arrivals'
import { lineKey } from './lineFilter'
import { trainRouteId } from './trainRoute'
import type { TrainStop } from './trainStops'

/**
 * Which stations the MTA's skip alerts say a route's trains pass, indexed by route, for the train and station panels
 * (the same sets `joinStationChanges` reads, so the two always agree). Built once per alerts snapshot; every lookup
 * takes the live clock, since the snapshot is up to minutes old.
 */
export interface AlertSkips {
  generatedAt: number
  byRoute: ReadonlyMap<RouteId, readonly RouteSkipSet[]>
}

/** Skipped by the MTA's header, or only our guess from the stops it lists (`RouteSkipSet.probable`): a guess is a note, never a strike. */
export type SkipMark = 'skips' | 'probably'

/** The skip index of a snapshot; null with none, or a schema the client doesn't read. */
export function alertSkipsOf(snapshot: AlertsSnapshot | null, schemaMismatch: boolean, stationById: ReadonlyMap<StationId, Station>): AlertSkips | null {
  if (snapshot === null || schemaMismatch) return null
  const byRoute = new Map<RouteId, RouteSkipSet[]>()
  for (const alert of snapshot.alerts) {
    for (const set of skipSetsOf(alert, stationById)) byRoute.set(set.route, [...(byRoute.get(set.route) ?? []), set])
  }
  return { generatedAt: snapshot.generatedAt, byRoute }
}

const activeAt = (set: RouteSkipSet, nowS: number): boolean => set.periods.some(([start, end]) => start <= nowS && (end === null || nowS < end))

/**
 * What the alerts say about trains of `route` going `direction` at any of `stationIds` (a complex: its members), in
 * effect at `nowS`. An alert for a line covers its express (the 6's covers the 6X), not the other way round. An alert
 * for both directions covers either; a train whose direction is unknown matches only those. A skip the header names
 * beats a guess. Null with no index or one older than ALERTS_MAX_AGE_S: unknown is not "skips".
 */
export function skipAt(
  skips: AlertSkips | null,
  route: RouteId,
  direction: Direction | null,
  stationIds: readonly StationId[],
  nowS: number,
): SkipMark | null {
  if (skips === null || nowS - skips.generatedAt > ALERTS_MAX_AGE_S) return null
  const line = lineKey(route)
  const own = skips.byRoute.get(route) ?? []
  const sets = line === route ? own : [...own, ...(skips.byRoute.get(line) ?? [])]
  let mark: SkipMark | null = null
  for (const set of sets) {
    if (set.direction !== null && set.direction !== direction) continue
    if (!stationIds.some((id) => set.stations.has(id)) || !activeAt(set, nowS)) continue
    if (!set.probable) return 'skips'
    mark = 'probably'
  }
  return mark
}

/** Whether any of `routeIds` skips any of `stationIds` in some direction now: the arrivals sizer's cue to reserve a note line. */
export function stationHasSkip(skips: AlertSkips | null, routeIds: readonly RouteId[], stationIds: readonly StationId[], nowS: number): boolean {
  return routeIds.some((r) => (['N', 'S'] as const).some((d) => skipAt(skips, r, d, stationIds, nowS) !== null))
}

export interface TrainLine {
  route: RouteId | null
  direction: Direction | null
}

/** The train's route and direction: the joined pattern's direction (GTFS 0 is N, as in alerts), else the feed's, else its first stop's suffix, else unknown. */
export function trainLine(
  trip: Pick<LiveTrip, 'trip' | 'shapeId'>,
  routeById: ReadonlyMap<RouteId, unknown>,
  patterns: Readonly<Record<ShapeId, TripPattern>>,
): TrainLine {
  const route = trainRouteId(trip, routeById, patterns)
  const fromPattern = patterns[trip.shapeId]?.direction
  if (fromPattern !== undefined) return { route, direction: fromPattern }
  if (trip.trip.direction !== null) return { route, direction: trip.trip.direction }
  const suffix = trip.trip.arrivals[0]?.[0].slice(-1)
  return { route, direction: suffix === 'N' || suffix === 'S' ? suffix : null }
}

export interface SkippableStop extends TrainStop {
  skip: SkipMark | null
}

/** Each stop with its mark. The stop the train is standing at is never marked: it is already there. */
export function markSkips(stops: readonly TrainStop[], markOf: (stationId: StationId) => SkipMark | null): SkippableStop[] {
  return stops.map((stop) => ({ ...stop, skip: stop.standing ? null : markOf(stationOfStop(stop.stopId)) }))
}

/** A skipped stop's row text: the dim visible line and the one sentence a screen reader gets in place of the name and times. */
export function skipStopText(name: string, mark: SkipMark): { note: string; spoken: string } {
  const lead = mark === 'probably' ? 'probably skips' : 'skips'
  return { note: `${lead} · per MTA notice`, spoken: `${lead} ${name}, per MTA notice` }
}

/** The arrivals row's dim note for a route and direction that skips the station. */
export function arrivalSkipNote(mark: SkipMark): string {
  return mark === 'probably' ? 'probably skips this station' : 'skips this station'
}
