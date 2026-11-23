import { createInteriorCache } from './interiorCache'
import { expectDataFile, expectDataRecord, fetchJson, HttpError } from './loadNetwork'
import type { TransfersFile, TripIndexFile } from './schema'
import { expectDatedIndex, expectTimetable } from './timetableCheck'
import { EMPTY_DATED_INDEX, type FrozenDatedIndex, type TimetableFile } from './timetableSchema'

export { expectDatedIndex, expectTimetable, type TimetableHolds } from './timetableCheck'

const BASE_URL = import.meta.env.BASE_URL

/** What the service-day picker reads from trip-index.json. */
export type ServiceCalendarFile = Pick<TripIndexFile, 'calendar' | 'calendarExceptions'>

/** What the trip reads from trip-index.json: the calendar, and the patterns that tell the map which shape a ride leg is on. */
export type TripIndexForTrips = ServiceCalendarFile & Pick<TripIndexFile, 'patterns'>

/** Checks a fetched trip-index.json for the calendar, its exceptions and the patterns' stop runs, and keeps only those. */
export function expectTripIndexForTrips(raw: unknown, url: string): TripIndexForTrips {
  const file = expectDataRecord<TripIndexFile>(raw, 'calendar', url)
  if (!Array.isArray((file as Partial<TripIndexFile>).calendarExceptions)) throw new Error(`${url}: not a calendar file`)
  const patterns: unknown = (file as Partial<TripIndexFile>).patterns
  if (typeof patterns !== 'object' || patterns === null || Array.isArray(patterns)) throw new Error(`${url}: not a patterns file`)
  for (const [shapeId, pattern] of Object.entries(patterns)) {
    const stops: unknown = (pattern as Partial<TripIndexFile['patterns'][string]> | null)?.stops
    if (!Array.isArray(stops) || !stops.every((s) => typeof s === 'string')) throw new Error(`${url}: pattern ${shapeId} has no stops`)
  }
  return { calendar: file.calendar, calendarExceptions: file.calendarExceptions, patterns: file.patterns }
}

// Lazy, one promise per file; a failure is evicted so the next call retries. Nothing here runs at import.
const timetableCache = createInteriorCache((serviceId) => {
  const url = `${BASE_URL}data/timetable/${encodeURIComponent(serviceId)}.json`
  return fetchJson(url).then((raw) => expectTimetable(raw, url, { service: serviceId }))
})
const datedFileCache = createInteriorCache((date) => {
  const url = `${BASE_URL}data/timetable/dated/${encodeURIComponent(date)}.json`
  return fetchJson(url).then((raw) => expectTimetable(raw, url, { date }))
})

const CONSTANT_KEY = 'file'
const transfersCache = createInteriorCache(() => {
  const url = `${BASE_URL}data/route/transfers.json`
  return fetchJson(url).then((raw) => expectDataFile<TransfersFile>(raw, 'transfers', url))
})
// The index is built by each deploy, never committed, so a 404 is a site with none (a local build, or an old deploy):
// the plan uses the service files, with one warning. Any other failure rejects, so the next call retries.
const datedIndexCache = createInteriorCache(() => {
  const url = `${BASE_URL}data/timetable/dated/index.json`
  return fetchJson(url).then(
    (raw) => expectDatedIndex(raw, url),
    (err: unknown) => {
      if (!(err instanceof HttpError && err.status === 404)) throw err
      console.warn(`${url}: HTTP 404; planning trips on the regular schedule, with no planned work`)
      return EMPTY_DATED_INDEX
    },
  )
})
const tripIndexCache = createInteriorCache(() => {
  const url = `${BASE_URL}data/trip-index.json`
  return fetchJson(url).then((raw) => expectTripIndexForTrips(raw, url))
})

/** `data/timetable/<serviceId>.json`, fetched once per page load. */
export function timetableFile(serviceId: string): Promise<TimetableFile> {
  return timetableCache.get(serviceId)
}

/** `data/route/transfers.json`, fetched once per page load. */
export function transfersFile(): Promise<TransfersFile> {
  return transfersCache.get(CONSTANT_KEY)
}

/** The calendar from `data/trip-index.json` (a lazy fetch of the big file, only when a trip is planned). */
export function serviceCalendar(): Promise<ServiceCalendarFile> {
  return tripIndexCache.get(CONSTANT_KEY).then(({ calendar, calendarExceptions }) => ({ calendar, calendarExceptions }))
}

/** The patterns from `data/trip-index.json`: the same one fetch as `serviceCalendar`, made when a trip is planned. */
export function tripPatterns(): Promise<TripIndexFile['patterns']> {
  return tripIndexCache.get(CONSTANT_KEY).then((file) => file.patterns)
}

/** `data/timetable/dated/<date>.json` (YYYYMMDD; only a date the index lists), fetched once per page load. */
export function datedTimetableFile(date: string): Promise<TimetableFile> {
  return datedFileCache.get(date)
}

/** `data/timetable/dated/index.json`: the dates with a dated file, fetched once per page load; none (a 404) is an empty index. */
export function datedTimetableIndex(): Promise<FrozenDatedIndex> {
  return datedIndexCache.get(CONSTANT_KEY)
}
