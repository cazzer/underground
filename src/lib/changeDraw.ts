/**
 * A picked service change on the map (08r.6): the route view (TripRouteDraw, kind 'change') that TripLines, TripMarks
 * and the route frame draw. Pure. The MTA lists a change's stops as parent stations in no order; per route and
 * direction they are put in order along the route's own shape, then found on the drawn lines as a trip's ride is
 * (tripSpans.ts rideSpan), so the stretch lies exactly on its direction's track. A skip draws the informed stretch at
 * full colour and marks only the stations skipped; a suspension (part or whole) draws its stretch dashed. Nothing here
 * says more than the notice: the panel says the drawing is ours.
 */
import type { AlertEntity, ServiceAlert } from '../data/realtime'
import type { Direction, RouteId, StationId, StopId } from '../data/schema'
import { alertKindOf, sharedDirection, skipSetsOf } from './live/alertStations'
import type { Station } from './network'
import { projectForward } from './realtime/polyline'
import type { TripRouteDraw } from './tripLineBuffers'
import type { TripMark } from './tripMarks'
import { MAX_STOP_OFFSET_M, rideSpan, type RideShapeSpan, type SpanShape } from './tripSpans'

export interface ChangeDrawContext {
  /** The drawn shapes (banded once the bands arrive): the stretches are found on what TripLines draws. */
  shapes: readonly SpanShape[]
  stationById: ReadonlyMap<StationId, Station>
  stopStations: ReadonlyMap<StopId, Station>
}

export interface ChangeDraw {
  route: TripRouteDraw
  /** Some skipped stations are our guess from the stops listed (RouteSkipSet.probable): the panel says "probably". */
  probable: boolean
}

const BOTH: readonly Direction[] = ['N', 'S']
const START = { segment: 0, t: 0 }

/** The stations of `route` the alert lists, each once in feed order (a station the network lacks is left out). */
function informedOf(alert: ServiceAlert, route: RouteId, stationById: ReadonlyMap<StationId, Station>): StationId[] {
  const ids = alert.entities.filter((e) => e.route === route && e.stop !== null && stationById.has(e.stop)).map((e) => e.stop!)
  return [...new Set(ids)]
}

/**
 * The stations' child stops of `direction`, in order along the route's first shape of that direction (primary first,
 * then by id) that passes within MAX_STOP_OFFSET_M of all of them; null when no shape does. A station with no stop of
 * that direction (a terminal's) is left out.
 */
function orderedRun(route: RouteId, direction: Direction, ids: readonly StationId[], ctx: ChangeDrawContext): StopId[] | null {
  const stops = ids.flatMap((id) => {
    const station = ctx.stationById.get(id)
    const stop = station?.stops.find((s) => s.endsWith(direction))
    return station && stop ? [{ stop, pos: station.pos }] : []
  })
  if (stops.length === 0) return null
  const shapes = ctx.shapes
    .filter((s) => s.routeId === route && s.direction === direction)
    .sort((a, b) => Number(b.primary) - Number(a.primary) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const shape of shapes) {
    const hits = stops.map((s) => projectForward(shape, s.pos, START))
    if (hits.every((h) => h.offsetM <= MAX_STOP_OFFSET_M)) {
      return stops.map((s, i) => ({ stop: s.stop, d: hits[i]!.distance })).sort((a, b) => a.d - b.d).map((s) => s.stop)
    }
  }
  return null
}

/**
 * The stretch of `route` through `ids` on each of `directions`, as drawn-shape spans. A single station draws no
 * stretch; a run no shape of the route orders, or one found on no drawn shape, warns and draws nothing (a straight
 * line would read as something the notice doesn't say).
 */
function stretches(alertId: string, route: RouteId, directions: readonly Direction[], ids: readonly StationId[], ctx: ChangeDrawContext): RideShapeSpan[] {
  const out: RideShapeSpan[] = []
  for (const direction of directions) {
    const run = orderedRun(route, direction, ids, ctx)
    if (run === null) {
      console.warn(`Service change ${alertId}: no ${route} shape going ${direction} passes its stations; not drawn`)
      continue
    }
    if (run.length < 2) continue
    const span = rideSpan({ routeId: route, stops: run }, out.length, { shapes: ctx.shapes, stopStations: ctx.stopStations })
    if (span.kind === 'ride') out.push({ ...span, legIndex: out.length })
    else console.warn(`Service change ${alertId}: its ${route} stretch going ${direction} is on no drawn line; not drawn`)
  }
  return out
}

/** Every primary shape of `route`, whole: a suspension of the whole route. */
function wholeRoute(route: RouteId, ctx: ChangeDrawContext): RideShapeSpan[] {
  return ctx.shapes
    .filter((s) => s.routeId === route && s.primary)
    .map((s, i) => ({ kind: 'ride', legIndex: i, routeId: route, shapeId: s.id, d0: 0, d1: s.length, maxOffsetM: 0, matched: 'route' }))
}

const hasStop = (e: AlertEntity, stationById: ReadonlyMap<StationId, Station>): boolean => e.stop !== null && stationById.has(e.stop)

/**
 * The route view of `alert`, keyed `key`; null for a change it can't draw (a delay or a notice, or one whose stations
 * lie on no line). A skip: per route its informed stretch, on the skip set's direction (both when the MTA names none),
 * and a mark at each station skipped (once, however many routes skip it; a complex's member at its own point). A
 * suspension: per route with stops its informed stretch, dashed, the ends unserved but unmarked; a route the alert names
 * only whole (a full suspension) every primary shape of it. Throws only for a broken network (a stop no station lists).
 */
export function serviceChangeDraw(alert: ServiceAlert, ctx: ChangeDrawContext, key: string): ChangeDraw | null {
  const kind = alertKindOf(alert.type)
  const rides: RideShapeSpan[] = []
  const suspended: RideShapeSpan[] = []
  const marks = new Map<StationId, TripMark>()
  const stations = new Set<StationId>()
  let probable = false
  if (kind === 'skip') {
    for (const set of skipSetsOf(alert, ctx.stationById)) {
      const informed = informedOf(alert, set.route, ctx.stationById)
      rides.push(...stretches(alert.id, set.route, set.direction ? [set.direction] : BOTH, informed, ctx))
      for (const id of set.stations) {
        const pos = ctx.stationById.get(id)!.pos
        if (!marks.has(id)) marks.set(id, { stationId: id, pos: { x: pos.x, z: pos.z }, role: 'skip' })
      }
      for (const id of informed) stations.add(id)
      probable ||= set.probable
    }
  } else if (kind === 'part' || kind === 'suspended') {
    for (const route of new Set(alert.entities.map((e) => e.route))) {
      const ofRoute = alert.entities.filter((e) => e.route === route)
      const withStops = ofRoute.filter((e) => hasStop(e, ctx.stationById))
      if (withStops.length > 0) {
        const informed = informedOf(alert, route, ctx.stationById)
        const direction = sharedDirection(withStops.map((e) => e.direction))
        suspended.push(...stretches(alert.id, route, direction ? [direction] : BOTH, informed, ctx))
        for (const id of informed) stations.add(id)
      } else if (kind === 'suspended' && ofRoute.some((e) => e.stop === null)) {
        const whole = wholeRoute(route, ctx)
        suspended.push(...whole)
        if (whole.length > 0) for (const st of ctx.stationById.values()) if (st.routeIds.includes(route)) stations.add(st.id)
      }
    }
  } else return null
  if (rides.length === 0 && suspended.length === 0 && marks.size === 0) return null
  const ids = [...stations]
  const frameStations = ids.map((id) => {
    const pos = ctx.stationById.get(id)!.pos
    return { x: pos.x, z: pos.z }
  })
  return {
    route: { kind: 'change', key, rides, suspended, straights: [], walks: [], marks: [...marks.values()], stations: ids, frameStations, faint: false },
    probable,
  }
}

/**
 * Whether a list row can be picked to draw: a skip with a skip set, a part suspension with a listed station, a
 * suspension with a listed station or a whole route. Cheap (no geometry): a pick may still draw nothing
 * (changeDrawNote says so).
 */
export function changeDrawable(alert: ServiceAlert, stationById: ReadonlyMap<StationId, Station>): boolean {
  switch (alertKindOf(alert.type)) {
    case 'skip':
      return skipSetsOf(alert, stationById).length > 0
    case 'part':
      return alert.entities.some((e) => hasStop(e, stationById))
    case 'suspended':
      return alert.entities.some((e) => e.stop === null || hasStop(e, stationById))
    default:
      return false
  }
}

export const DRAWN_NOTE = 'Drawn from the MTA notice'
export const PROBABLE_NOTE = `${DRAWN_NOTE} · skipped stops probably as shown`
export const NOT_DRAWN_NOTE = 'Not drawn on the map: no line matches the notice'

/** The picked row's dim line: the drawing is ours, from the MTA's notice (and the skips our guess), or nothing drew. */
export function changeDrawNote(draw: ChangeDraw | null): string {
  if (draw === null) return NOT_DRAWN_NOTE
  return draw.probable ? PROBABLE_NOTE : DRAWN_NOTE
}
