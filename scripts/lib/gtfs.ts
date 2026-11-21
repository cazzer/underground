import type { Direction, RouteId, ServiceId, StopId } from '../../src/data/schema.ts'
import { parseCsv } from './csv.ts'

export interface StopRow {
  id: StopId
  name: string
  lat: number
  lon: number
  locationType: number
  parent: string
}
export interface RouteRow {
  id: RouteId
  shortName: string
  longName: string
  color: string
  textColor: string
  sortOrder: number
}
export interface TripRow {
  id: string
  routeId: RouteId
  serviceId: ServiceId
  direction: Direction
  /** Raw shape_id; may be empty or single-dot ("GS.N01R"). */
  shapeId: string
}
export interface StopTimeRow {
  tripId: string
  stopId: StopId
  /** Seconds after service-day midnight; can exceed 86400. */
  arrival: number
  departure: number
  sequence: number
}
export interface ShapePointRow {
  shapeId: string
  sequence: number
  lat: number
  lon: number
}
export interface TransferRow {
  from: string
  to: string
  /** Raw min_transfer_time; may be blank. */
  minTransferTime: string
}
export interface CalendarRow {
  serviceId: ServiceId
  /** Active days, Date.getUTCDay() numbering. */
  days: number[]
  start: string
  end: string
}
export interface CalendarDateRow {
  serviceId: ServiceId
  date: string
  exceptionType: 1 | 2
}
export interface GtfsFeed {
  feedVersion: string
  stops: StopRow[]
  routes: RouteRow[]
  trips: TripRow[]
  stopTimes: StopTimeRow[]
  shapePoints: ShapePointRow[]
  transfers: TransferRow[]
  calendar: CalendarRow[]
  calendarDates: CalendarDateRow[]
}

/** Plain code-unit string order, so sorts don't depend on the locale. */
export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function parseNum(value: string, what: string): number {
  const n = value.trim() === '' ? NaN : Number(value)
  if (Number.isNaN(n)) throw new Error(`Expected a number for ${what}, got ${JSON.stringify(value)}`)
  return n
}

/** "25:10:30" → 90630. GTFS hours run past 24 for trips after midnight. */
export function parseGtfsTime(value: string): number {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value)
  if (!m) throw new Error(`Bad GTFS time ${JSON.stringify(value)}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

function parseDirection(value: string): Direction {
  if (value === '0') return 'N'
  if (value === '1') return 'S'
  throw new Error(`Bad direction_id ${JSON.stringify(value)}`)
}

function parseException(value: string): 1 | 2 {
  if (value === '1') return 1
  if (value === '2') return 2
  throw new Error(`Bad exception_type ${JSON.stringify(value)}`)
}

// Sunday first, so index = Date.getUTCDay().
const DAY_COLUMNS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** `texts` maps file name ("stops.txt") to its decoded content. */
export function readFeed(texts: Record<string, string>): GtfsFeed {
  const table = (file: string, required: string[]) => {
    const text = texts[file]
    if (text === undefined) throw new Error(`Missing GTFS table ${file}`)
    return parseCsv(text, file, required)
  }
  const info = table('feed_info.txt', ['feed_version'])[0]
  if (!info?.feed_version) throw new Error('feed_info.txt has no feed_version')

  return {
    feedVersion: info.feed_version,
    stops: table('stops.txt', ['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'parent_station']).map(
      (r) => ({
        id: r.stop_id!,
        name: r.stop_name!,
        lat: parseNum(r.stop_lat!, `stop_lat of ${r.stop_id}`),
        lon: parseNum(r.stop_lon!, `stop_lon of ${r.stop_id}`),
        locationType: r.location_type === '' ? 0 : parseNum(r.location_type!, `location_type of ${r.stop_id}`),
        parent: r.parent_station!,
      }),
    ),
    routes: table('routes.txt', [
      'route_id',
      'route_short_name',
      'route_long_name',
      'route_color',
      'route_text_color',
      'route_sort_order',
    ]).map((r) => ({
      id: r.route_id!,
      shortName: r.route_short_name!,
      longName: r.route_long_name!,
      color: r.route_color!,
      textColor: r.route_text_color!,
      sortOrder: parseNum(r.route_sort_order!, `route_sort_order of ${r.route_id}`),
    })),
    trips: table('trips.txt', ['route_id', 'trip_id', 'service_id', 'direction_id', 'shape_id']).map((r) => ({
      id: r.trip_id!,
      routeId: r.route_id!,
      serviceId: r.service_id!,
      direction: parseDirection(r.direction_id!),
      shapeId: r.shape_id!,
    })),
    stopTimes: table('stop_times.txt', [
      'trip_id',
      'stop_id',
      'arrival_time',
      'departure_time',
      'stop_sequence',
    ]).map((r) => ({
      tripId: r.trip_id!,
      stopId: r.stop_id!,
      arrival: parseGtfsTime(r.arrival_time!),
      departure: parseGtfsTime(r.departure_time!),
      sequence: parseNum(r.stop_sequence!, `stop_sequence of ${r.trip_id}`),
    })),
    shapePoints: table('shapes.txt', ['shape_id', 'shape_pt_sequence', 'shape_pt_lat', 'shape_pt_lon']).map((r) => ({
      shapeId: r.shape_id!,
      sequence: parseNum(r.shape_pt_sequence!, `shape_pt_sequence of ${r.shape_id}`),
      lat: parseNum(r.shape_pt_lat!, `shape_pt_lat of ${r.shape_id}`),
      lon: parseNum(r.shape_pt_lon!, `shape_pt_lon of ${r.shape_id}`),
    })),
    transfers: table('transfers.txt', ['from_stop_id', 'to_stop_id', 'min_transfer_time']).map((r) => ({
      from: r.from_stop_id!,
      to: r.to_stop_id!,
      minTransferTime: r.min_transfer_time!,
    })),
    calendar: table('calendar.txt', ['service_id', ...DAY_COLUMNS, 'start_date', 'end_date']).map((r) => ({
      serviceId: r.service_id!,
      days: DAY_COLUMNS.flatMap((col, day) => (r[col] === '1' ? [day] : [])),
      start: r.start_date!,
      end: r.end_date!,
    })),
    calendarDates: table('calendar_dates.txt', ['service_id', 'date', 'exception_type']).map((r) => ({
      serviceId: r.service_id!,
      date: r.date!,
      exceptionType: parseException(r.exception_type!),
    })),
  }
}

/** stop_times grouped by trip, each group sorted by stop_sequence. Input order is irrelevant. */
export function groupByTrip(stopTimes: readonly StopTimeRow[]): Map<string, StopTimeRow[]> {
  const groups = new Map<string, StopTimeRow[]>()
  for (const row of stopTimes) {
    const group = groups.get(row.tripId)
    if (group) group.push(row)
    else groups.set(row.tripId, [row])
  }
  for (const group of groups.values()) group.sort((a, b) => a.sequence - b.sequence)
  return groups
}
