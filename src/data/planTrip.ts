import type { StationId, StationsFile } from './schema'
import { serviceCalendar, timetableFile, transfersFile } from './loadTimetable'
import { planOn, type RouterTimetable, type TripJourney } from '../lib/route/plan'
import { serviceWindow, windowKey } from '../lib/route/serviceDay'
import { buildRouterTimetable, sourcesFor } from '../lib/route/timetable'
import type { RouteOptions } from '../lib/route/types'

/** The calendar has no service on the query's date (past its end, or before its start). */
export class NoServiceError extends Error {
  readonly date: string
  constructor(date: string) {
    super(`no service on ${date}`)
    this.name = 'NoServiceError'
    this.date = date
  }
}

/** A User Timing measure from `start` (a `performance.now()` value) to now; `?debug` and devtools read it. */
function measureSince(name: string, start: number): void {
  performance.measure(name, { start, end: performance.now() })
}

let last: { key: string; promise: Promise<RouterTimetable> } | undefined

async function build(stations: StationsFile, atS: number): Promise<RouterTimetable> {
  const { calendar, calendarExceptions } = await serviceCalendar()
  const window = serviceWindow(atS, calendar, calendarExceptions)
  if (window.frames.length === 0) throw new NoServiceError(window.date)
  const key = `${stations.feedVersion}|${windowKey(window)}`
  if (last?.key === key) return last.promise
  const serviceIds = [...new Set(window.frames.flatMap((f) => f.services))]
  const fetchStart = performance.now()
  const promise = Promise.all([transfersFile(), ...serviceIds.map(timetableFile)]).then(([transfers, ...files]) => {
    measureSince('trip:fetch', fetchStart)
    const buildStart = performance.now()
    const byService = new Map(serviceIds.map((id, i) => [id, files[i]!]))
    const timetable = buildRouterTimetable(sourcesFor(window, byService), stations, transfers.transfers)
    measureSince('trip:build', buildStart)
    return { timetable, window }
  })
  const entry = { key, promise }
  last = entry
  // A failed build is forgotten so the next call retries; the caller still gets the rejection.
  promise.catch(() => {
    if (last === entry) last = undefined
  })
  return promise
}

/** The router's timetable for the window around `atS` (epoch seconds), fetched and built once per window. */
export function loadRouterTimetable(stations: StationsFile, atS: number): Promise<RouterTimetable> {
  return build(stations, atS)
}

/** Journeys from any of `from` to any of `to` leaving no earlier than `atS` (epoch seconds). Fetches lazily. */
export async function planTrip(
  stations: StationsFile,
  from: readonly StationId[],
  to: readonly StationId[],
  atS: number,
  opts?: RouteOptions,
): Promise<TripJourney[]> {
  const rt = await loadRouterTimetable(stations, atS)
  const start = performance.now()
  const journeys = planOn(rt, from, to, atS, opts)
  measureSince('trip:route', start)
  return journeys
}
