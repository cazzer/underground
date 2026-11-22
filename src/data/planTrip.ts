import type { StationId, StationsFile } from './schema'
import { serviceCalendar, timetableFile, transfersFile } from './loadTimetable'
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
 * Journeys between two stations the visitor chose, each standing for its complex (same-named stations linked by
 * transfers), so a trip never begins or ends with a walk to a station of the same name. Two ends in one complex are
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
  const { transfers } = await transfersFile()
  const fromSet = complexMembers(stations.stations, from, transfers)
  const toSet = complexMembers(stations.stations, to, transfers)
  if (fromSet.some((id) => toSet.includes(id))) return { journeys: [], overlay: null, sameStation: true }
  return { ...(await planTripLive(stations, fromSet, toSet, atS, live, opts)), sameStation: false }
}
