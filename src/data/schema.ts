/** Contracts for public/data/*.json, written by scripts/build-data.ts. Change both sides together. */

/** Canonical shape id `<token>..<N|S><path>`, e.g. "1..S03R", "GS..N01R" (GTFS writes "GS.N01R"). */
export type ShapeId = string
/** GTFS route_id, e.g. "A", "6X", "GS", "SI". */
export type RouteId = string
/** Parent station (location_type 1), e.g. "101". */
export type StationId = string
/** Platform child stop = station id + direction, e.g. "101N". Realtime uses these. */
export type StopId = string
export type Direction = 'N' | 'S'
/** GTFS service_id: "Weekday" | "Saturday" | "Sunday" in this feed. */
export type ServiceId = string

export interface DataFile {
  /** feed_info.txt feed_version; identical across all six files of one build. */
  feedVersion: string
}

export interface Station {
  id: StationId
  name: string
  /** WGS84 degrees, rounded to 5 dp. */
  lat: number
  lon: number
  /** Child stop ids, sorted. */
  stops: StopId[]
  /** Routes with any scheduled trip calling here (any service, any hour), in route_sort_order. */
  routes: RouteId[]
}
export interface StationsFile extends DataFile {
  stations: Station[] // sorted by id
}

export interface Route {
  id: RouteId
  /** route_short_name; GS, FS and H are all "S", SI is "SIR". */
  shortName: string
  /** route_long_name, needed to tell the three "S" shuttles apart. */
  longName: string
  /** 6-digit uppercase hex, no '#'. GTFS defaults when blank: FFFFFF / 000000. */
  color: string
  textColor: string
}
export interface RoutesFile extends DataFile {
  routes: Route[] // route_sort_order
}

export interface Shape {
  id: ShapeId
  routeId: RouteId
  direction: Direction
  /** Most-used shape (by trip count) of its routeId+direction; ties go to the smaller id. 58 in fall 2026. */
  primary: boolean
  /** Douglas-Peucker at 3 m. Degrees x 1e5 as integers, delta-encoded (first absolute,
   *  then differences). Decode with decodeShapePoints, then project with projection.ts. */
  lat: number[]
  lon: number[]
}
/** Every shape referenced by trip-index, sorted by id. */
export interface ShapesFile extends DataFile {
  shapes: Shape[]
}

export interface SegmentsFile extends DataFile {
  /** segmentKey(from, to) ("101S>103S") → median scheduled seconds from departure at
   *  `from` to arrival at `to`, over all trips and services. Directional; dwell excluded. */
  segments: Record<string, number>
}

export interface Transfer {
  from: StationId
  to: StationId
  minTransferSec: number
}
/** from !== to; both directions listed; sorted by from, then to. */
export interface TransfersFile extends DataFile {
  transfers: Transfer[]
}

export interface TripPattern {
  /** trips.txt route_id. Can differ from the shape id's token: W runs on N..*, 6X on 6..*,
   *  7X on 7..*, FX on F..*, Z on J..*. Realtime may use either, so register both keys. */
  routeId: RouteId
  direction: Direction
  /** Ordered child stops the trip calls at. */
  stops: StopId[]
}
export interface ServiceCalendar {
  /** Active weekdays, Date.getUTCDay() numbering (0 = Sunday), ascending. */
  days: number[]
  /** YYYYMMDD inclusive. */
  start: string
  end: string
}
export interface CalendarException {
  date: string // YYYYMMDD
  serviceId: ServiceId
  /** 1 = service added on date, 2 = removed (GTFS exception_type). */
  exceptionType: 1 | 2
}
export interface TripIndexFile extends DataFile {
  calendar: Record<ServiceId, ServiceCalendar>
  /** Sorted by date, then serviceId. */
  calendarExceptions: CalendarException[]
  /** One pattern per shape (1:1 in this feed; the build fails if not). */
  patterns: Record<ShapeId, TripPattern>
  /** service → shape → origin times of its trips, ascending and unique, delta-encoded.
   *  Origin = the 6-digit trip-id prefix as an integer: hundredths of a minute after
   *  service-day midnight (can exceed 144000). Realtime key = tripKey(origin, route, dir).
   *  A key without a path code can match several shapes (48 do in fall 2026). Resolve it to
   *  the shape flagged `primary` for the key's route+direction if it is among the matches,
   *  otherwise to the lowest shape id. */
  origins: Record<ServiceId, Record<ShapeId, number[]>>
}
