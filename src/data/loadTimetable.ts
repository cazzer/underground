import { createInteriorCache } from './interiorCache'
import { expectDataFile, expectDataRecord, fetchJson } from './loadNetwork'
import type { TransfersFile, TripIndexFile } from './schema'
import { TIMETABLE_FORMAT, type TimetableFile } from './timetableSchema'

const BASE_URL = import.meta.env.BASE_URL

/** What the service-day picker reads from trip-index.json. */
export type ServiceCalendarFile = Pick<TripIndexFile, 'calendar' | 'calendarExceptions'>

/**
 * Checks the outer shape of a fetched timetable file: the format, the services it holds (must include `serviceId`),
 * and each pattern's route, direction, stops and trips array. Trip internals are checked by `decodePatternTimes`.
 */
export function expectTimetable(raw: unknown, url: string, serviceId: string): TimetableFile {
  const fail = (why: string) => new Error(`${url}: not a timetable file (${why})`)
  if (typeof raw !== 'object' || raw === null) throw fail('not an object')
  const file = raw as Record<string, unknown>
  if (file.format !== TIMETABLE_FORMAT) throw fail(`format ${String(file.format)}, expected ${TIMETABLE_FORMAT}`)
  if (typeof file.feedVersion !== 'string') throw fail('no feedVersion')
  if (!Array.isArray(file.services) || !file.services.every((s) => typeof s === 'string')) throw fail('no services list')
  if (!file.services.includes(serviceId)) throw fail(`holds ${file.services.join(', ')}, not ${serviceId}`)
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

/** Checks a fetched trip-index.json for the calendar and its exceptions, and keeps only those. */
export function expectServiceCalendar(raw: unknown, url: string): ServiceCalendarFile {
  const file = expectDataRecord<TripIndexFile>(raw, 'calendar', url)
  if (!Array.isArray((file as Partial<TripIndexFile>).calendarExceptions)) throw new Error(`${url}: not a calendar file`)
  return { calendar: file.calendar, calendarExceptions: file.calendarExceptions }
}

// Lazy, one promise per file; a failure is evicted so the next call retries. Nothing here runs at import.
const timetableCache = createInteriorCache((serviceId) => {
  const url = `${BASE_URL}data/timetable/${encodeURIComponent(serviceId)}.json`
  return fetchJson(url).then((raw) => expectTimetable(raw, url, serviceId))
})

const CONSTANT_KEY = 'file'
const transfersCache = createInteriorCache(() => {
  const url = `${BASE_URL}data/transfers.json`
  return fetchJson(url).then((raw) => expectDataFile<TransfersFile>(raw, 'transfers', url))
})
const calendarCache = createInteriorCache(() => {
  const url = `${BASE_URL}data/trip-index.json`
  return fetchJson(url).then((raw) => expectServiceCalendar(raw, url))
})

/** `data/timetable/<serviceId>.json`, fetched once per page load. */
export function timetableFile(serviceId: string): Promise<TimetableFile> {
  return timetableCache.get(serviceId)
}

/** `data/transfers.json`, fetched once per page load. */
export function transfersFile(): Promise<TransfersFile> {
  return transfersCache.get(CONSTANT_KEY)
}

/** The calendar from `data/trip-index.json` (a lazy fetch of the big file, only when a trip is planned). */
export function serviceCalendar(): Promise<ServiceCalendarFile> {
  return calendarCache.get(CONSTANT_KEY)
}
