/** Dated timetables (public/data/timetable/dated/<YYYYMMDD>.json) from the MTA's supplemented GTFS: the regular
 *  service plus the next days' planned work, as one file per date. The contract is src/data/timetableSchema.ts.
 *  Pure; never reads the clock. A date outside the window has no file and the client falls back to the per-service
 *  files, which are exact there. */
import type { CalendarException, ServiceCalendar, ServiceId, StopId } from '../../src/data/schema.ts'
import { servicesOn, addDays } from '../../src/lib/realtime/serviceDate.ts'
import {
  TIMETABLE_FORMAT,
  type DatedTimetableIndex,
  type StationChange,
  type TimetableFile,
} from '../../src/data/timetableSchema.ts'
import { compareIds, groupByTrip, type GtfsFeed, type TripRow } from './gtfs.ts'
import { patternsOf } from './timetable.ts'

/** The most days a window may span; more means the feed changed shape (or something is wrong), so the build fails. */
export const DATED_MAX_DAYS = 14

/** Every date from the first to the last on which a date-only service runs: a service that a calendar_dates row
 *  adds (type 1) and calendar.txt does not list. [] if there is none. Throws above DATED_MAX_DAYS days. */
export function datedWindow(feed: GtfsFeed): string[] {
  const listed = new Set(feed.calendar.map((c) => c.serviceId))
  const dates = feed.calendarDates.filter((d) => d.exceptionType === 1 && !listed.has(d.serviceId)).map((d) => d.date).sort(compareIds)
  if (dates.length === 0) return []
  const first = dates[0]!
  const last = dates[dates.length - 1]!
  const window: string[] = []
  for (let date = first; date <= last; date = addDays(date, 1)) {
    window.push(date)
    if (window.length > DATED_MAX_DAYS) {
      throw new Error(`Date-only services run from ${first} to ${last}: more than ${DATED_MAX_DAYS} days, so the dated window is not trusted`)
    }
  }
  return window
}

/** One dated file per date of `datedWindow(feed)` (a gap day inside it included), the manifest and the pattern
 *  counts. `changes` is the regular feed's station changes, put in every file; `knownStops` is the stop set of
 *  stations.json, and a pattern calling at any other stop throws, naming the stops and dates. See `patternsOf` for
 *  the other throws. */
export function buildDatedTimetables(
  feed: GtfsFeed,
  changes: readonly StationChange[],
  knownStops: ReadonlySet<StopId>,
): {
  index: DatedTimetableIndex
  files: { date: string; file: TimetableFile }[]
  skippedShort: number
  splitPatterns: number
} {
  const dates = datedWindow(feed)
  const stops = new Map(feed.stops.map((s) => [s.id, s]))
  const stopTimes = groupByTrip(feed.stopTimes)
  const tripsByService = new Map<ServiceId, TripRow[]>()
  for (const trip of feed.trips) {
    const list = tripsByService.get(trip.serviceId)
    if (list) list.push(trip)
    else tripsByService.set(trip.serviceId, [trip])
  }
  // The same conversion trip-index.json carries, so the client and this build read one calendar.
  const calendar: Record<ServiceId, ServiceCalendar> = Object.fromEntries(
    feed.calendar.map((c) => [c.serviceId, { days: [...c.days].sort((a, b) => a - b), start: c.start, end: c.end }]),
  )
  const exceptions: CalendarException[] = feed.calendarDates.map((d) => ({ date: d.date, serviceId: d.serviceId, exceptionType: d.exceptionType }))

  const unknown = new Map<StopId, string[]>()
  let skippedShort = 0
  let splitPatterns = 0
  const files = dates.map((date) => {
    const services = servicesOn(date, calendar, exceptions)
    const trips = services.flatMap((id) => tripsByService.get(id) ?? [])
    const built = patternsOf(trips, stopTimes, stops)
    skippedShort += built.skippedShort
    splitPatterns += built.splitPatterns
    for (const stop of new Set(built.patterns.flatMap((p) => p.stops))) {
      if (!knownStops.has(stop)) unknown.set(stop, [...(unknown.get(stop) ?? []), date])
    }
    const file: TimetableFile = { format: TIMETABLE_FORMAT, feedVersion: feed.feedVersion, date, services, changes: [...changes], patterns: built.patterns }
    return { date, file }
  })
  if (unknown.size > 0) {
    const list = [...unknown].map(([stop, on]) => `${stop} (${on.join(', ')})`).join('; ')
    throw new Error(`The supplemented feed calls at stops that stations.json lacks: ${list}`)
  }
  return { index: { format: 1, feedVersion: feed.feedVersion, dates }, files, skippedShort, splitPatterns }
}
