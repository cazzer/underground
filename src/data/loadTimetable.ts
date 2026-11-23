import { createInteriorCache } from './interiorCache'
import { expectDataFile, expectDataRecord, fetchJson, HttpError } from './loadNetwork'
import type { TransfersFile, TripIndexFile } from './schema'
import { EMPTY_DATED_INDEX, TIMETABLE_FORMAT, type DatedTimetableIndex, type TimetableFile } from './timetableSchema'

const BASE_URL = import.meta.env.BASE_URL

/** What the service-day picker reads from trip-index.json. */
export type ServiceCalendarFile = Pick<TripIndexFile, 'calendar' | 'calendarExceptions'>

/** What a fetched timetable file must say it is: a service file holds `service`; a dated file's `date` is its own. */
export type TimetableHolds = { service: string } | { date: string }

/**
 * Checks the outer shape of a fetched timetable file: the format, what it holds (a service file's `services` must
 * include the service, a dated file's `date` must equal the one asked for), and each pattern's route, direction,
 * stops and trips array. Trip internals are checked by `decodePatternTimes`.
 */
export function expectTimetable(raw: unknown, url: string, holds: TimetableHolds): TimetableFile {
  const fail = (why: string) => new Error(`${url}: not a timetable file (${why})`)
  if (typeof raw !== 'object' || raw === null) throw fail('not an object')
  const file = raw as Record<string, unknown>
  if (file.format !== TIMETABLE_FORMAT) throw fail(`format ${String(file.format)}, expected ${TIMETABLE_FORMAT}`)
  if (typeof file.feedVersion !== 'string') throw fail('no feedVersion')
  if (!Array.isArray(file.services) || !file.services.every((s) => typeof s === 'string')) throw fail('no services list')
  if ('service' in holds) {
    if (!file.services.includes(holds.service)) throw fail(`holds ${file.services.join(', ')}, not ${holds.service}`)
  } else if (file.date !== holds.date) {
    throw fail(`dated ${String(file.date)}, not ${holds.date}`)
  }
  if (!Array.isArray(file.changes)) throw fail('no changes list')
  if (!Array.isArray(file.patterns)) throw fail('no patterns list')
  file.patterns.forEach((entry: unknown, i) => {
    const p = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : undefined
    if (typeof p?.routeId !== 'string') throw fail(`pattern ${i} has no routeId`)
    if (p.direction !== 'N' && p.direction !== 'S') throw fail(`pattern ${i} has no direction`)
    if (!Array.isArray(p.stops) || p.stops.length < 2 || !p.stops.every((s) => typeof s === 'string')) {
      throw fail(`pattern ${i} needs at least two stop ids`)
    }
    if (!Array.isArray(p.trips)) throw fail(`pattern ${i} has no trips list`)
  })
  return raw as TimetableFile
}

/** Checks a fetched dated/index.json: the format, a feedVersion and the dates (sorted, unique, YYYYMMDD). */
export function expectDatedIndex(raw: unknown, url: string): DatedTimetableIndex {
  const fail = (why: string) => new Error(`${url}: not a dated timetable index (${why})`)
  if (typeof raw !== 'object' || raw === null) throw fail('not an object')
  const file = raw as Record<string, unknown>
  if (file.format !== TIMETABLE_FORMAT) throw fail(`format ${String(file.format)}, expected ${TIMETABLE_FORMAT}`)
  if (typeof file.feedVersion !== 'string') throw fail('no feedVersion')
  const dates = file.dates
  if (!Array.isArray(dates) || !dates.every((d) => typeof d === 'string' && /^\d{8}$/.test(d))) throw fail('dates are not YYYYMMDD strings')
  if (dates.some((d, i) => i > 0 && d <= (dates[i - 1] as string))) throw fail('dates are not sorted and unique')
  return raw as DatedTimetableIndex
}

/** Checks a fetched trip-index.json for the calendar and its exceptions, and keeps only those. */
export function expectServiceCalendar(raw: unknown, url: string): ServiceCalendarFile {
  const file = expectDataRecord<TripIndexFile>(raw, 'calendar', url)
  if (!Array.isArray((file as Partial<TripIndexFile>).calendarExceptions)) throw new Error(`${url}: not a calendar file`)
  return { calendar: file.calendar, calendarExceptions: file.calendarExceptions }
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
const calendarCache = createInteriorCache(() => {
  const url = `${BASE_URL}data/trip-index.json`
  return fetchJson(url).then((raw) => expectServiceCalendar(raw, url))
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
  return calendarCache.get(CONSTANT_KEY)
}

/** `data/timetable/dated/<date>.json` (YYYYMMDD; only a date the index lists), fetched once per page load. */
export function datedTimetableFile(date: string): Promise<TimetableFile> {
  return datedFileCache.get(date)
}

/** `data/timetable/dated/index.json`: the dates with a dated file, fetched once per page load; none (a 404) is an empty index. */
export function datedTimetableIndex(): Promise<DatedTimetableIndex> {
  return datedIndexCache.get(CONSTANT_KEY)
}
