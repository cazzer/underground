/** Contract for public/data/timetable/<serviceId>.json, written by scripts/build-data.ts (scripts/lib/timetable.ts).
 *  Change both sides together. Types and consts only; `timetableCodec.ts` decodes it.
 *
 *  Rules the builder keeps and a client may rely on:
 *  - Time base: seconds after service-day midnight. A time may pass 86,400 (past 24:00 belongs to the
 *    previous day's service). Every time is stored in TIMETABLE_UNIT_SEC units.
 *  - dep: the first trip of a pattern is absolute; each later trip is the delta from the previous trip's
 *    first departure (>= 0).
 *  - runs: runs[i-1] = arrival at stops[i] minus departure from stops[i-1], in units, >= 0, so its length
 *    is stops.length - 1.
 *  - dwell: flat [index, units, index, units, ...], ascending indexes, units > 0; units = departure minus
 *    arrival at stops[index]. A trip with no dwell is a 2-tuple. Index 0 is allowed (the train arrives
 *    before its first departure; none in fall 2026) and so is the last index (240 trips).
 *  - Decoding: dep0 = sum of dep; arr0 = dep0 - dwell0; arr_i = dep_(i-1) + runs[i-1]; dep_i = arr_i + dwell_i.
 *  - Trip order: sorted by first departure, and within a pattern no trip overtakes (each trip's arrival and
 *    departure are >= the previous trip's at every stop). The builder splits a group of trips that fails
 *    this, so one (route, direction, stops) can appear as consecutive patterns.
 *  - Pattern order: routeId, direction, stops (element-wise, then length), all in plain code-unit order;
 *    lanes of one group keep their creation order.
 *  - changes: the transfers.txt rows with from = to, one per parent station, sorted by station, identical in
 *    every file of a build. Between-station transfers stay in transfers.json.
 *  - Key order: format, feedVersion, services, changes, patterns. The file is rendered one trip per line.
 *  - No trip identity: a trip is found by its first departure.
 */
import type { Direction, RouteId, ServiceId, StationId, StopId } from './schema.ts'

export const TIMETABLE_FORMAT = 1
/** Every time in a timetable file is a whole number of these (all MTA times are). */
export const TIMETABLE_UNIT_SEC = 30

/** [dep, runs] or [dep, runs, dwell]. */
export type TimetableTrip = [dep: number, runs: number[]] | [dep: number, runs: number[], dwell: number[]]

export interface TimetablePattern {
  routeId: RouteId
  direction: Direction
  /** Ordered child stop ids ("101N"), at least two. */
  stops: StopId[]
  trips: TimetableTrip[]
}

/** Minimum time to change trains inside one station (transfers.txt, from = to). */
export interface StationChange {
  station: StationId
  minTransferSec: number
}

export interface TimetableFile {
  format: 1
  /** feed_info feed_version of the zip it was built from. Its own field: never compared with stations.json at runtime. */
  feedVersion: string
  /** GTFS service_ids whose trips the file holds: one per file from the regular zip. */
  services: ServiceId[]
  changes: StationChange[]
  patterns: TimetablePattern[]
}
