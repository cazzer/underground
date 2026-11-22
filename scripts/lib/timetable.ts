/** Per-service timetables (public/data/timetable/<serviceId>.json): stop_times regrouped by stop pattern in
 *  30 s units, plus the same-station transfers.txt rows. The file contract is src/data/timetableSchema.ts.
 *  Pure. Never reads shape_id or the trip id: a trip is identified by its times alone. */
import type { Direction, RouteId, ServiceId, StationId, StopId } from '../../src/data/schema.ts'
import {
  TIMETABLE_FORMAT,
  TIMETABLE_UNIT_SEC,
  type StationChange,
  type TimetableFile,
  type TimetablePattern,
  type TimetableTrip,
} from '../../src/data/timetableSchema.ts'
import { compareIds, groupByTrip, parseNum, type GtfsFeed, type StopRow, type StopTimeRow } from './gtfs.ts'

/** A service id becomes a file name, so it may not carry a path. */
const SERVICE_ID = /^[A-Za-z0-9_-]+$/

/** The transfers.txt rows with from = to: the minimum time to change trains inside one station. */
export function buildStationChanges(feed: GtfsFeed): StationChange[] {
  const parents = new Set(feed.stops.filter((s) => s.locationType === 1).map((s) => s.id))
  const seen = new Set<StationId>()
  const changes: StationChange[] = []
  for (const t of feed.transfers) {
    if (t.from !== t.to) continue
    if (!parents.has(t.from)) throw new Error(`Same-station transfer at ${t.from}, which is not a parent station`)
    if (seen.has(t.from)) throw new Error(`Station ${t.from} has more than one same-station transfer`)
    seen.add(t.from)
    changes.push({ station: t.from, minTransferSec: parseNum(t.minTransferTime, `min_transfer_time ${t.from}>${t.to}`) })
  }
  return changes.sort((a, b) => compareIds(a.station, b.station))
}

/** One trip's times in units. */
interface Run {
  tripId: string
  arr: number[]
  dep: number[]
}

interface Group {
  routeId: RouteId
  direction: Direction
  stops: StopId[]
  runs: Run[]
}

function toUnits(seconds: number, tripId: string, stopId: StopId): number {
  if (!Number.isInteger(seconds) || seconds % TIMETABLE_UNIT_SEC !== 0) {
    throw new Error(`Trip ${tripId} at ${stopId}: time ${seconds} s is not a multiple of ${TIMETABLE_UNIT_SEC} s`)
  }
  return seconds / TIMETABLE_UNIT_SEC
}

function readRun(tripId: string, rows: readonly StopTimeRow[], stops: ReadonlyMap<StopId, StopRow>): Run {
  const arr: number[] = []
  const dep: number[] = []
  for (const row of rows) {
    const stop = stops.get(row.stopId)
    if (!stop) throw new Error(`Trip ${tripId} calls at unknown stop ${row.stopId}`)
    if (stop.locationType !== 0 || stop.parent === '') throw new Error(`Trip ${tripId} calls at ${row.stopId}, which is not a child stop`)
    const a = toUnits(row.arrival, tripId, row.stopId)
    const d = toUnits(row.departure, tripId, row.stopId)
    if (d < a) throw new Error(`Trip ${tripId} at ${row.stopId}: departs before it arrives`)
    if (dep.length > 0 && a < dep[dep.length - 1]!) throw new Error(`Trip ${tripId} at ${row.stopId}: arrives before it left the previous stop`)
    arr.push(a)
    dep.push(d)
  }
  return { tripId, arr, dep }
}

/** True if `next` runs ahead of `prev` at any stop (it would arrive or leave before the earlier trip). */
function overtakes(next: Run, prev: Run): boolean {
  return next.arr.some((a, i) => a < prev.arr[i]!) || next.dep.some((d, i) => d < prev.dep[i]!)
}

function compareRuns(a: Run, b: Run): number {
  for (const [x, y] of [[a.dep, b.dep], [a.arr, b.arr]] as const) {
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!
  }
  return compareIds(a.tripId, b.tripId)
}

function encodeLane(group: Group, runs: readonly Run[]): TimetablePattern {
  let previous = 0
  const trips: TimetableTrip[] = runs.map((run) => {
    const dep = run.dep[0]! - previous
    previous = run.dep[0]!
    const gaps = run.arr.slice(1).map((a, i) => a - run.dep[i]!)
    const dwell: number[] = []
    run.arr.forEach((a, i) => {
      if (run.dep[i]! > a) dwell.push(i, run.dep[i]! - a)
    })
    return dwell.length > 0 ? [dep, gaps, dwell] : [dep, gaps]
  })
  return { routeId: group.routeId, direction: group.direction, stops: group.stops, trips }
}

function comparePatterns(a: TimetablePattern, b: TimetablePattern): number {
  let c = compareIds(a.routeId, b.routeId) || compareIds(a.direction, b.direction)
  for (let i = 0; c === 0 && i < Math.min(a.stops.length, b.stops.length); i++) c = compareIds(a.stops[i]!, b.stops[i]!)
  return c || a.stops.length - b.stops.length
}

/** One non-overtaking pattern per lane: each trip joins the first lane it doesn't overtake, else opens a new one. */
function lanesOf(group: Group): Run[][] {
  const lanes: Run[][] = []
  for (const run of [...group.runs].sort(compareRuns)) {
    const lane = lanes.find((l) => !overtakes(run, l[l.length - 1]!))
    if (lane) lane.push(run)
    else lanes.push([run])
  }
  return lanes
}

/** One file per service id (calendar, calendar_dates or trips); a service with no trips gets no patterns.
 *  Trips with fewer than two stop_times are skipped and counted; `splitPatterns` counts the extra lanes
 *  made for trips that overtake. Throws, naming the trip, on a time that is not a whole unit, a negative
 *  run, or a stop that is not a child stop. */
export function buildTimetables(feed: GtfsFeed): {
  files: { serviceId: ServiceId; file: TimetableFile }[]
  skippedShort: number
  splitPatterns: number
} {
  const ids = new Set<ServiceId>([
    ...feed.calendar.map((c) => c.serviceId),
    ...feed.calendarDates.map((d) => d.serviceId),
    ...feed.trips.map((t) => t.serviceId),
  ])
  const serviceIds = [...ids].sort(compareIds)
  for (const id of serviceIds) {
    if (!SERVICE_ID.test(id)) throw new Error(`Service id ${JSON.stringify(id)} cannot be a file name`)
  }

  const stops = new Map(feed.stops.map((s) => [s.id, s]))
  const stopTimes = groupByTrip(feed.stopTimes)
  const groups = new Map<ServiceId, Map<string, Group>>(serviceIds.map((id) => [id, new Map()]))
  let skippedShort = 0
  for (const trip of feed.trips) {
    const rows = stopTimes.get(trip.id)
    if (!rows || rows.length < 2) {
      skippedShort++
      continue
    }
    const run = readRun(trip.id, rows, stops)
    const stopIds = rows.map((r) => r.stopId)
    const key = `${trip.routeId}|${trip.direction}|${stopIds.join(',')}`
    const byKey = groups.get(trip.serviceId)!
    const group = byKey.get(key)
    if (group) group.runs.push(run)
    else byKey.set(key, { routeId: trip.routeId, direction: trip.direction, stops: stopIds, runs: [run] })
  }

  const changes = buildStationChanges(feed)
  let splitPatterns = 0
  const files = serviceIds.map((serviceId) => {
    const patterns: TimetablePattern[] = []
    for (const group of groups.get(serviceId)!.values()) {
      const lanes = lanesOf(group)
      splitPatterns += lanes.length - 1
      for (const lane of lanes) patterns.push(encodeLane(group, lane))
    }
    patterns.sort(comparePatterns)
    const file: TimetableFile = { format: TIMETABLE_FORMAT, feedVersion: feed.feedVersion, services: [serviceId], changes, patterns }
    return { serviceId, file }
  })
  return { files, skippedShort, splitPatterns }
}
