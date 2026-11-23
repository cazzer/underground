/** The checks the dated build runs on its own output before it writes anything (the files are not committed, so no test
 *  reads them): the index and its files agree, each file passes the client's own shape check and decodes, no trip overtakes
 *  another, and every route, stop and station change is one the committed site data knows (what `buildRouterTimetable`
 *  would otherwise skip with its "stale or mixed deploy" warning). Pure; throws on the first problem. */
import type { RouteId, StopId } from '../../src/data/schema.ts'
import { decodePatternTimes } from '../../src/data/timetableCodec.ts'
import { expectDatedIndex, expectTimetable } from '../../src/data/timetableCheck.ts'
import type { DatedTimetableIndex, TimetableFile } from '../../src/data/timetableSchema.ts'
import { addDays } from '../../src/lib/realtime/serviceDate.ts'
import { DATED_MAX_DAYS } from './datedTimetable.ts'

/** What the committed site data (routes.json, stations.json) knows. */
export interface DatedCheckKnown {
  routeIds: ReadonlySet<RouteId>
  stops: ReadonlySet<StopId>
}

const PLAIN_SERVICE_ID = /^[A-Za-z0-9_-]+$/

export function checkDatedOutputs(
  files: readonly { date: string; file: TimetableFile }[],
  index: DatedTimetableIndex,
  known: DatedCheckKnown,
): void {
  expectDatedIndex(index, 'dated/index.json')
  if (index.dates.length > DATED_MAX_DAYS) throw new Error(`The index lists ${index.dates.length} dates, over the ${DATED_MAX_DAYS} limit`)
  for (const date of index.dates) {
    if (addDays(date, 0) !== date) throw new Error(`The index lists ${date}, which is not a real date`)
  }
  const fileDates = files.map((f) => f.date)
  if (fileDates.join() !== index.dates.join()) {
    throw new Error(`The index lists [${index.dates.join(' ')}] but the files are [${fileDates.join(' ')}]`)
  }
  const stations = new Set([...known.stops].map((stop) => stop.slice(0, -1)))
  for (const { date, file } of files) checkFile(date, file, index, known, stations)
}

function checkFile(date: string, file: TimetableFile, index: DatedTimetableIndex, known: DatedCheckKnown, stations: ReadonlySet<string>): void {
  expectTimetable(file, `${date}.json`, { date })
  if (file.feedVersion !== index.feedVersion) {
    throw new Error(`${date}.json: feedVersion ${JSON.stringify(file.feedVersion)}, the index says ${JSON.stringify(index.feedVersion)}`)
  }
  if (file.services.length === 0) throw new Error(`${date}.json: no active service`)
  for (const id of file.services) {
    if (!PLAIN_SERVICE_ID.test(id)) throw new Error(`${date}.json: service id ${JSON.stringify(id)} is not a plain id (letters, digits, _ and -)`)
  }
  for (const { station } of file.changes) {
    if (!stations.has(station)) throw new Error(`${date}.json: a station change for ${station}, which stations.json lacks (the regular feed is newer than the committed data)`)
  }
  for (const pattern of file.patterns) {
    const key = `${date}.json ${pattern.routeId}|${pattern.direction}|${pattern.stops}`
    if (!known.routeIds.has(pattern.routeId)) throw new Error(`${key}: route ${pattern.routeId} is not in routes.json`)
    for (const stop of pattern.stops) {
      if (!known.stops.has(stop)) throw new Error(`${key}: stop ${stop} is not in stations.json`)
    }
    const times = decodePatternTimes(pattern) // throws on a bad runs length or dwell
    for (let i = 1; i < times.length; i++) {
      const before = times[i - 1]!
      const after = times[i]!
      const ordered = after.arrivals.every((a, s) => a >= before.arrivals[s]!) && after.departures.every((d, s) => d >= before.departures[s]!)
      if (!ordered) throw new Error(`${key}: trip ${i} overtakes trip ${i - 1}`)
    }
  }
}
