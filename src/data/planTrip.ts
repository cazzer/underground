import type { StationId, StationsFile } from './schema'
import { datedTimetableFile, datedTimetableIndex, serviceCalendar, timetableFile, transfersFile } from './loadTimetable'
import { complexMembers } from '../lib/route/ends'
import type { RouterTimetable, TripJourney } from '../lib/route/plan'
import { measureSince } from '../lib/route/measure'
import { planOnLive, type LiveInput, type LivePlan } from '../lib/route/planLive'
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

let last: { key: string; promise: Promise<RouterTimetable> } | undefined

async function build(stations: StationsFile, atS: number): Promise<RouterTimetable> {
  // A failed index fetch rejects the plan (and is retried by the next one): planned work must not vanish silently.
  // datedTimetableIndex() is empty, with a warning, when the site has no dated index (404).
  const [{ calendar, calendarExceptions }, datedIndex] = await Promise.all([serviceCalendar(), datedTimetableIndex()])
  const window = serviceWindow(atS, calendar, calendarExceptions, new Set(datedIndex.dates))
  if (window.frames.length === 0) throw new NoServiceError(window.date)
  const key = `${stations.feedVersion}|${windowKey(window)}`
  if (last?.key === key) return last.promise
  // A dated frame reads its date's file instead of its services' files.
  const serviceIds = [...new Set(window.frames.filter((f) => !f.dated).flatMap((f) => f.services))]
  const dates = window.frames.filter((f) => f.dated).map((f) => f.date)
  const fetchStart = performance.now()
  const promise = Promise.all([
    transfersFile(),
    Promise.all(serviceIds.map(timetableFile)),
    Promise.all(dates.map(datedTimetableFile)),
  ]).then(([transfers, files, datedFiles]) => {
    measureSince('trip:fetch', fetchStart)
    const buildStart = performance.now()
    const byService = new Map(serviceIds.map((id, i) => [id, files[i]!]))
    const byDate = new Map(dates.map((date, i) => [date, datedFiles[i]!]))
    const timetable = buildRouterTimetable(sourcesFor(window, byService, byDate), stations, transfers.transfers)
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

/**
 * Journeys from any of `from` to any of `to` leaving no earlier than `atS` (epoch seconds). Fetches lazily. With
 * `live` the next 30 minutes come from realtime (`planOnLive`); `atS` should then be the live clock.
 */
export async function planTripLive(
  stations: StationsFile,
  from: readonly StationId[],
  to: readonly StationId[],
  atS: number,
  live: LiveInput | null,
  opts?: RouteOptions,
): Promise<LivePlan> {
  return planOnLive(await loadRouterTimetable(stations, atS), from, to, atS, live, opts)
}

/** Scheduled journeys only; see `planTripLive`. */
export async function planTrip(
  stations: StationsFile,
  from: readonly StationId[],
  to: readonly StationId[],
  atS: number,
  opts?: RouteOptions,
): Promise<TripJourney[]> {
  return (await planTripLive(stations, from, to, atS, null, opts)).journeys
}

/**
 * Journeys between two stations the visitor chose, each standing for its complex (stations.json `complexes`), so a
 * trip never begins or ends with a walk to another member of it. Two ends in one complex are
 * one place: no journeys, and `sameStation` says why.
 */
export async function planTripBetween(
  stations: StationsFile,
  from: StationId,
  to: StationId,
  atS: number,
  live: LiveInput | null = null,
  opts?: RouteOptions,
): Promise<LivePlan & { sameStation: boolean }> {
  const fromSet = complexMembers(stations.complexes ?? [], from)
  const toSet = complexMembers(stations.complexes ?? [], to)
  if (fromSet.some((id) => toSet.includes(id))) return { journeys: [], overlay: null, sameStation: true }
  return { ...(await planTripLive(stations, fromSet, toSet, atS, live, opts)), sameStation: false }
}
