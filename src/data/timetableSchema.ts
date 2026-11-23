/** Contract for public/data/timetable/<serviceId>.json (written by scripts/build-data.ts, scripts/lib/timetable.ts) and
 *  timetable/dated/<YYYYMMDD>.json (built by every Pages deploy, never committed: scripts/build-dated.ts,
 *  scripts/lib/datedTimetable.ts). Change both sides together.
 *  Types and consts only; `timetableCodec.ts` decodes it.
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
 *  - Dated files: dated/<date>.json holds every trip that runs on that date in the MTA's supplemented feed (planned
 *    work applied) and replaces the day's service files for the router; `date` equals the file name and `services`
 *    lists that day's active supplemented service ids (informational). dated/index.json (DatedTimetableIndex) lists
 *    the dates that have a file: those on which planned work changes the trips that run (additions or removals), at
 *    most 14, not necessarily contiguous. Any other date uses the service files. A deploy that could not build them
 *    ships an empty index (EMPTY_DATED_INDEX), and a site with no index file at all (404) reads as that too.
 *  - A dated file's `changes` come from the regular feed read at that deploy and may differ from the service files'
 *    (committed with the last refresh); the router takes the minimum per station (lib/route/timetable.ts).
 *  - Key order: format, feedVersion, [date,] services, changes, patterns. The file is rendered one trip per line.
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
  /** A dated file only (dated/<date>.json): its YYYYMMDD service date, equal to the file name. */
  date?: string
  /** GTFS service_ids whose trips the file holds: one per file from the regular zip; for a dated file, that day's active supplemented ids. */
  services: ServiceId[]
  changes: StationChange[]
  patterns: TimetablePattern[]
}

/** public/data/timetable/dated/index.json: the dates that have a dated file. */
export interface DatedTimetableIndex {
  format: 1
  /** feed_info feed_version of the supplemented zip the files were built from; '' when the deploy built none. */
  feedVersion: string
  /** YYYYMMDD, sorted, unique, at most DATED_MAX_DAYS; not necessarily contiguous. */
  dates: string[]
}

/** A dated index nothing may change: what the client caches (a shared empty one must not be mutated). */
export type FrozenDatedIndex = Readonly<Omit<DatedTimetableIndex, 'dates'>> & { readonly dates: readonly string[] }

/** The index of a deploy that built no dated files (or whose index is missing): every date uses the service files. */
export const EMPTY_DATED_INDEX: FrozenDatedIndex = Object.freeze({ format: 1, feedVersion: '', dates: Object.freeze<string[]>([]) })
