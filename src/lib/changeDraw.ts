/**
 * A picked service change on the map (08r.6): the route view (TripRouteDraw, kind 'change') that TripLines, TripMarks
 * and the route frame draw. Pure. The MTA lists a change's stops as parent stations in no order; per route and
 * direction they are put in order along the route's own shape, then found on the drawn lines as a trip's ride is
 * (tripSpans.ts rideSpan), so the stretch lies exactly on its direction's track. A skip draws the informed stretch at
 * full colour and marks only the stations skipped; a suspension (part or whole) draws its stretch dashed; an Express to
 * Local change and a reroute are drawn by their stations (changeDrawStops.ts). Nothing here says more than the notice:
 * the panel says the drawing is ours.
 */
import type { AlertEntity, ServiceAlert } from '../data/realtime'
import type { Direction, RouteId, StationId } from '../data/schema'
import { addedSetsOf, type ServiceOf } from './live/alertAdded'
import { alertKindOf, sharedDirection, skipSetsOf } from './live/alertStations'
import type { Station } from './network'
import { BOTH, informedOf, orderedRun, type ChangeDrawContext } from './changeRun'
import { localChangeDraw, rerouteChangeDraw, rerouteStations } from './changeDrawStops'
import type { TripRouteDraw } from './tripLineBuffers'
import type { TripMark } from './tripMarks'
import { rideSpan, type RideShapeSpan } from './tripSpans'

export type { ChangeDrawContext } from './changeRun'

export interface ChangeDraw {
  route: TripRouteDraw
  /** Some skipped stations are our guess from the stops listed (RouteSkipSet.probable): the panel says "probably". */
  probable: boolean
  /**
   * What the drawing rests on: the notice alone, the notice and the regular schedule (an Express to Local change's added stops
   * are the informed ones the route doesn't normally call at), or only the stations the notice names (a reroute).
   */
  basis: 'notice' | 'timetable' | 'names'
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
 * only whole (a full suspension) every primary shape of it. An Express to Local change and a reroute: changeDrawStops.ts.
 * Throws only for a broken network (a stop no station lists).
 */
export function serviceChangeDraw(alert: ServiceAlert, ctx: ChangeDrawContext, key: string): ChangeDraw | null {
  const kind = alertKindOf(alert.type)
  const rides: RideShapeSpan[] = []
  const suspended: RideShapeSpan[] = []
  const marks = new Map<StationId, TripMark>()
  const stations = new Set<StationId>()
  let probable = false
  let basis: ChangeDraw['basis'] = 'notice'
  let frame: StationId[] | null = null
  if (kind === 'local' || kind === 'reroute') {
    const d = kind === 'local' ? localChangeDraw(alert, ctx) : rerouteChangeDraw(alert, ctx)
    rides.push(...d.rides)
    for (const m of d.marks) marks.set(m.stationId, m)
    for (const id of d.stations) stations.add(id)
    frame = d.frame
    basis = kind === 'local' ? 'timetable' : 'names'
  } else if (kind === 'skip') {
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
  const frameStations = (frame ?? ids).map((id) => {
    const pos = ctx.stationById.get(id)!.pos
    return { x: pos.x, z: pos.z }
  })
  return {
    route: { kind: 'change', key, rides, suspended, straights: [], walks: [], placeWalks: [], places: [], marks: [...marks.values()], stations: ids, frameStations, faint: false },
    probable,
    basis,
  }
}

/**
 * Whether a list row can be picked to draw: what serviceChangeDraw draws, by its own rules, without geometry. A skip
 * with a skip set (it always marks); an Express to Local change with an added set (it marks them; none while
 * `serviceOf` is null); a reroute with a named station; a suspension, part or whole, with a route that lists two
 * stations or more (a stretch; one station draws nothing), or for a whole suspension a route named alone that some
 * station serves. Only a stretch no drawn line holds (warned) can still draw nothing (changeDrawNote says so).
 */
export function changeDrawable(alert: ServiceAlert, stationById: ReadonlyMap<StationId, Station>, serviceOf: ServiceOf | null): boolean {
  const kind = alertKindOf(alert.type)
  if (kind === 'skip') return skipSetsOf(alert, stationById).length > 0
  if (kind === 'local') return serviceOf !== null && addedSetsOf(alert, { stationById, serviceOf }).length > 0
  if (kind === 'reroute') return rerouteStations(alert, stationById).length > 0
  if (kind !== 'part' && kind !== 'suspended') return false
  return [...new Set(alert.entities.map((e) => e.route))].some((route) => {
    const ofRoute = alert.entities.filter((e) => e.route === route)
    if (ofRoute.some((e) => hasStop(e, stationById))) return informedOf(alert, route, stationById).length >= 2
    return kind === 'suspended' && ofRoute.some((e) => e.stop === null) && [...stationById.values()].some((st) => st.routeIds.includes(route))
  })
}

export const DRAWN_NOTE = 'Drawn from the MTA notice'
export const PROBABLE_NOTE = `${DRAWN_NOTE} · skipped stops probably as shown`
export const TIMETABLE_NOTE = 'Drawn from the MTA notice and the regular schedule'
export const NAMES_NOTE = "Stations named in the MTA notice · the new route isn't drawn"
export const NOT_DRAWN_NOTE = "Can't be drawn on the map"

/**
 * The picked row's dim line: the drawing is ours, from the MTA's notice (and the skips our guess, or the added stops
 * from the regular schedule), only the stations a reroute names, or nothing drew.
 * `from` is the start of a change not yet in effect ("11:45 PM", nyWhen's wording), so the map isn't read as now.
 */
export function changeDrawNote(draw: ChangeDraw | null, from: string | null = null): string {
  if (draw === null) return NOT_DRAWN_NOTE
  const note = draw.basis === 'timetable' ? TIMETABLE_NOTE : draw.basis === 'names' ? NAMES_NOTE : draw.probable ? PROBABLE_NOTE : DRAWN_NOTE
  return from === null ? note : `${note} · from ${from}`
}
