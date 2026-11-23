/** Dated timetables (timetable/dated/<YYYYMMDD>.json, built by each deploy by scripts/build-dated.ts) from the MTA's supplemented GTFS: the regular
 *  service plus the next days' planned work, as one file per date that planned work touches. The contract is
 *  src/data/timetableSchema.ts. Pure; never reads the clock. A date has a file when the supplemented feed runs a
 *  different set of trips on it than the regular feed does (work that only removes trains counts); every other date
 *  has none and the client falls back to the per-service files, which are exact there. */
import type { CalendarException, ServiceCalendar, ServiceId, StopId } from '../../src/data/schema.ts'
import { addDays, servicesOn } from '../../src/lib/realtime/serviceDate.ts'
import {
  TIMETABLE_FORMAT,
  type DatedTimetableIndex,
  type StationChange,
  type TimetableFile,
} from '../../src/data/timetableSchema.ts'
import { compareIds, groupByTrip, type GtfsFeed, type TripRow } from './gtfs.ts'
import { patternsOf } from './timetable.ts'

/** The most dated files there may be; more means the feed changed shape (or something is wrong), so the build fails. */
export const DATED_MAX_DAYS = 14

/** One feed's calendar as `servicesOn` reads it (the conversion trip-index.json carries) and its trip ids per service. */
export interface ServiceDays {
  calendar: Record<ServiceId, ServiceCalendar>
  exceptions: CalendarException[]
  tripIds: Map<ServiceId, string[]>
}

export function serviceDays(feed: GtfsFeed): ServiceDays {
  const tripIds = new Map<ServiceId, string[]>()
  for (const trip of feed.trips) {
    const list = tripIds.get(trip.serviceId)
    if (list) list.push(trip.id)
    else tripIds.set(trip.serviceId, [trip.id])
  }
  return {
    calendar: Object.fromEntries(
      feed.calendar.map((c) => [c.serviceId, { days: [...c.days].sort((a, b) => a - b), start: c.start, end: c.end }]),
    ),
    exceptions: feed.calendarDates
      .map((d) => ({ date: d.date, serviceId: d.serviceId, exceptionType: d.exceptionType }))
      .sort((a, b) => compareIds(a.date, b.date) || compareIds(a.serviceId, b.serviceId)),
    tripIds,
  }
}

/** A date becomes a file name, so it must be a real YYYYMMDD calendar date and nothing else. */
function checkDate(date: string): void {
  if (!/^\d{8}$/.test(date) || addDays(date, 0) !== date) {
    throw new Error(`Calendar date ${JSON.stringify(date)} is not a YYYYMMDD date, so it cannot be a file name`)
  }
}

/** Every date from the first to the last on which a date-only service runs: a service that a calendar_dates row
 *  adds (type 1) and calendar.txt does not list. [] if there is none. Throws above DATED_MAX_DAYS days. */
export function datedWindow(feed: GtfsFeed): string[] {
  const listed = new Set(feed.calendar.map((c) => c.serviceId))
  const dates = feed.calendarDates.filter((d) => d.exceptionType === 1 && !listed.has(d.serviceId)).map((d) => d.date).sort(compareIds)
  if (dates.length === 0) return []
  dates.forEach(checkDate)
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

function activeTripIds(days: ServiceDays, date: string): Set<string> {
  return new Set(servicesOn(date, days.calendar, days.exceptions).flatMap((id) => days.tripIds.get(id) ?? []))
}

/** The dates that get a file, sorted: of every date with a supplemented calendar_dates row, and every date of the
 *  date-only window, those on which the two feeds run different trips. The set need not be contiguous. Throws above
 *  DATED_MAX_DAYS dates, naming them. */
export function datedDates(feed: GtfsFeed, supplemented: ServiceDays, regular: ServiceDays): string[] {
  const rows = [...new Set(feed.calendarDates.map((d) => d.date))]
  rows.forEach(checkDate)
  const candidates = [...new Set([...rows, ...datedWindow(feed)])].sort(compareIds)
  const dated = candidates.filter((date) => {
    const a = activeTripIds(supplemented, date)
    const b = activeTripIds(regular, date)
    return a.size !== b.size || [...a].some((id) => !b.has(id))
  })
  if (dated.length > DATED_MAX_DAYS) {
    throw new Error(`Planned work changes ${dated.length} dates (${dated.join(', ')}): more than ${DATED_MAX_DAYS}, so the dated set is not trusted`)
  }
  return dated
}

/** One dated file per date of `datedDates`, the manifest and the pattern counts. `regular` is the regular feed's
 *  `serviceDays`; `changes` is its station changes, put in every file; `knownStops` is the stop set of stations.json,
 *  and a pattern calling at any other stop throws, naming the stops and dates. See `patternsOf` for the other throws. */
export function buildDatedTimetables(
  feed: GtfsFeed,
  regular: ServiceDays,
  changes: readonly StationChange[],
  knownStops: ReadonlySet<StopId>,
): {
  index: DatedTimetableIndex
  files: { date: string; file: TimetableFile }[]
  skippedShort: number
  splitPatterns: number
} {
  const days = serviceDays(feed)
  const dates = datedDates(feed, days, regular)
  const stops = new Map(feed.stops.map((s) => [s.id, s]))
  const stopTimes = groupByTrip(feed.stopTimes)
  const tripsByService = new Map<ServiceId, TripRow[]>()
  for (const trip of feed.trips) {
    const list = tripsByService.get(trip.serviceId)
    if (list) list.push(trip)
    else tripsByService.set(trip.serviceId, [trip])
  }

  const unknown = new Map<StopId, string[]>()
  let skippedShort = 0
  let splitPatterns = 0
  const files = dates.map((date) => {
    const services = servicesOn(date, days.calendar, days.exceptions)
    const built = patternsOf(services.flatMap((id) => tripsByService.get(id) ?? []), stopTimes, stops)
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
