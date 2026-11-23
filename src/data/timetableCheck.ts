/** Outer-shape checks of a timetable file and a dated index. Pure, with `.ts` imports because scripts/lib/datedCheck.ts
 *  (the deploy's dated build) runs them under plain node; loadTimetable.ts re-exports them for the client. */
import { TIMETABLE_FORMAT, type DatedTimetableIndex, type TimetableFile } from './timetableSchema.ts'

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
