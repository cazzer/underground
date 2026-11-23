/**
 * The two service changes drawn by their stations (08r.8). Pure. An Express to Local change draws the stretch it runs
 * local over at full colour, from the station before its first added stop to the one after its last (stations the
 * route calls at anyway), and marks each added stop (role `added`, ring and dot). A reroute's new path is only in the
 * MTA's words, so nothing is drawn along it: only the stations its notice names (role `named`, a plain ring), the
 * informed ones and its header's two ends.
 */
import type { ServiceAlert } from '../data/realtime'
import type { RouteId, StationId, StopId } from '../data/schema'
import { addedSetsOf } from './live/alertAdded'
import { candidatesOf, headerEnds } from './live/alertStations'
import type { Station } from './network'
import { informedOf, orderedRun, type ChangeDrawContext } from './changeRun'
import type { TripMark, TripMarkRole } from './tripMarks'
import { rideSpan, type RideShapeSpan } from './tripSpans'

/** What a change drawn by its stations adds to the route view. */
export interface StopsDraw {
  rides: RideShapeSpan[]
  marks: TripMark[]
  /** Every station the drawing is about (they keep their full ring while the network dims). */
  stations: StationId[]
  /** The ground points the route frame fits. */
  frame: StationId[]
}

const mark = (st: Station, role: TripMarkRole): TripMark => ({ stationId: st.id, pos: { x: st.pos.x, z: st.pos.z }, role })

/** The run from the stop before the first added one to the stop after the last (as far as the run goes). */
function sliceAround(run: readonly StopId[], added: ReadonlySet<StopId>): StopId[] {
  const first = run.findIndex((s) => added.has(s))
  if (first === -1) return []
  const last = run.findLastIndex((s) => added.has(s))
  return run.slice(Math.max(0, first - 1), Math.min(run.length, last + 2))
}

/**
 * Per added set (alertAdded.ts), the route's primary stations and the added ones ordered along its shape, cut to one
 * station either side of the added stretch, as a drawn-shape ride; an 'added' mark at each added station (once,
 * whatever sets add it, and one per complex, its first added member, as for a reroute). A run no shape orders, or one on no drawn line, warns and draws only the marks. Nothing
 * without `ctx.serviceOf`.
 */
export function localChangeDraw(alert: ServiceAlert, ctx: ChangeDrawContext): StopsDraw {
  const out: StopsDraw = { rides: [], marks: [], stations: [], frame: [] }
  if (ctx.serviceOf === null) return out
  const leads = new Set<StationId>()
  const stations = new Set<StationId>()
  for (const set of addedSetsOf(alert, { stationById: ctx.stationById, serviceOf: ctx.serviceOf })) {
    for (const id of set.stations) {
      stations.add(id)
      const st = ctx.stationById.get(id)!
      if (!leads.has(st.leadId)) out.marks.push(mark(st, 'added'))
      leads.add(st.leadId)
    }
    const primary = ctx.serviceOf(set.route, set.direction)?.primary ?? []
    const run = orderedRun(set.route, set.direction, [...new Set([...primary, ...set.stations])].filter((id) => ctx.stationById.has(id)), ctx)
    if (run === null) {
      console.warn(`Service change ${alert.id}: no ${set.route} shape going ${set.direction} passes its stations; only marked`)
      continue
    }
    const addedStops = new Set(run.filter((s) => set.stations.has(ctx.stopStations.get(s)?.id ?? '')))
    const slice = sliceAround(run, addedStops)
    for (const s of slice) stations.add(ctx.stopStations.get(s)!.id)
    if (slice.length < 2) continue
    const span = rideSpan({ routeId: set.route, stops: slice }, out.rides.length, { shapes: ctx.shapes, stopStations: ctx.stopStations })
    if (span.kind === 'ride') out.rides.push({ ...span, legIndex: out.rides.length })
    else console.warn(`Service change ${alert.id}: its ${set.route} stretch going ${set.direction} is on no drawn line; only marked`)
  }
  out.stations = [...stations]
  out.frame = out.stations
  return out
}

/**
 * A reroute's named stations: per route the informed stations, then its header's two ends ("between Canal St and
 * DeKalb Av", read against the route's stations), each once in that order; a station the network lacks is left out.
 */
export function rerouteStations(alert: ServiceAlert, stationById: ReadonlyMap<StationId, Station>): StationId[] {
  const ids = new Set<StationId>()
  for (const route of new Set<RouteId>(alert.entities.map((e) => e.route))) {
    const informed = informedOf(alert, route, stationById)
    for (const id of informed) ids.add(id)
    for (const id of headerEnds(alert.header, candidatesOf(stationById, route, informed)) ?? []) ids.add(id)
  }
  return [...ids]
}

/**
 * A reroute: no ride and no stretch, a 'named' mark at each named station, one per complex (its first named member:
 * Canal St's Q and R platforms are one mark). Every named station keeps its ring; the frame fits the marks.
 */
export function rerouteChangeDraw(alert: ServiceAlert, ctx: ChangeDrawContext): StopsDraw {
  const stations = rerouteStations(alert, ctx.stationById)
  const leads = new Set<StationId>()
  const marks: TripMark[] = []
  for (const id of stations) {
    const st = ctx.stationById.get(id)!
    if (leads.has(st.leadId)) continue
    leads.add(st.leadId)
    marks.push(mark(st, 'named'))
  }
  return { rides: [], marks, stations, frame: marks.map((m) => m.stationId) }
}
