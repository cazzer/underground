import { ALERT_WINDOW_S, type AlertEntity, type AlertsSnapshot, type ServiceAlert } from '../../data/realtime'
import type { Direction, RouteId, StationId } from '../../data/schema'
import type { Station } from '../network'
import type { StationGroup } from '../stationGroups'
import { addedSetsOf, serviceOrNull, type NormalService, type ServiceOf } from './alertAdded'
import { alertKindOf, sharedDirection, skipSetsOf, stretchEnds } from './alertStations'
import { lineKey } from './lineFilter'

/**
 * An alerts snapshot older than this (by the live clock) is unknown, not "no service changes": four times the
 * Worker's cache TTL, as for outages (`ENE_MAX_AGE_S`).
 */
export const ALERTS_MAX_AGE_S = 480

export type AlertsStatus =
  /** Not configured, or still connecting (nothing polled yet, fewer than two failures). */
  | 'none'
  /** No snapshot younger than ALERTS_MAX_AGE_S, a version mismatch, or two failed polls with nothing yet. */
  | 'unknown'
  /** A fresh snapshot: it says what changes, or that nothing does. */
  | 'known'

/** The part of useAlerts' feed the join reads (this module doesn't import src/data/useAlerts). */
export interface AlertsInput {
  configured: boolean
  snapshot: AlertsSnapshot | null
  failures: number
  schemaMismatch: boolean
}

/** What a change does at this station: trains skip it, there is no service here, an express stops here, or a notice we only quote. */
export type ChangeKind = 'skipped' | 'suspended' | 'added' | 'other'

export interface StationChange {
  alertId: string
  kind: ChangeKind
  /** The routes the change is about at this station, in `routeOrder`. */
  routes: readonly RouteId[]
  /** One direction, or null for both. */
  direction: Direction | null
  /** The kind is our guess (the header's wording wasn't readable): the panel says "probably". */
  probable: boolean
  /** In effect at `nowS`. */
  now: boolean
  /** When it starts, for a change that isn't in effect yet; null for one that is, or that has no start. */
  from: number | null
  /** When the period in effect ends; null when open-ended or not in effect. */
  until: number | null
  /** The MTA's header, verbatim. */
  header: string
  /** The alert's free-text type ("Delays"), which alertText's typeWord puts in our words for a change that is neither a skip nor a suspension. */
  type: string | null
  /** Every entity behind this change names a whole route, none a stop here: listed after the changes that are about this station. */
  routeWide: boolean
}

export type StationChanges =
  /** Not configured, still connecting, or fresh data with nothing for this station. */
  | { kind: 'none' }
  /** No fresh data says whether anything changes here. */
  | { kind: 'unknown' }
  | { kind: 'changes'; changes: StationChange[] }

export interface ChangesJoin {
  panel: StationChanges
  /** Fresh data says what changes here (or that nothing does): the only time a difference is news. */
  known: boolean
}

/** Whether the feed says anything: the one rule the station join and the header's list share. */
export function alertsStatus(input: AlertsInput, nowS: number): AlertsStatus {
  if (!input.configured) return 'none'
  const { snapshot } = input
  if (snapshot !== null && nowS - snapshot.generatedAt <= ALERTS_MAX_AGE_S && !input.schemaMismatch) return 'known'
  return snapshot === null && input.failures < 2 && !input.schemaMismatch ? 'none' : 'unknown'
}

const NONE: ChangesJoin = { panel: { kind: 'none' }, known: false }
const KIND_ORDER: Record<ChangeKind, number> = { skipped: 0, suspended: 1, added: 2, other: 3 }

export interface RelevantPeriod {
  now: boolean
  start: number
  end: number | null
}

/** The period of `alert` in effect at `nowS`, else the next one starting within the window; null when neither. */
export function relevantPeriod(alert: ServiceAlert, nowS: number): RelevantPeriod | null {
  let next: RelevantPeriod | null = null
  for (const [start, end] of alert.periods) {
    if (end !== null && end <= nowS) continue
    if (start <= nowS) return { now: true, start, end }
    if (start < nowS + ALERT_WINDOW_S && (next === null || start < next.start)) next = { now: false, start, end }
  }
  return next
}

/**
 * Whether an entity concerns the station: its stop is a member's, or it names a whole route the station has a line of
 * (an express folded into its line: delays on the 7X reach the 7). A suspension is exact: a 6X-only suspension is not
 * "no service here" at every 6 station, so its whole-route entities must name a route the station has.
 */
function reaches(e: AlertEntity, memberIds: ReadonlySet<StationId>, lines: ReadonlySet<string>, routes: ReadonlySet<RouteId>, exact: boolean): boolean {
  if (e.stop !== null) return memberIds.has(e.stop)
  return exact ? routes.has(e.route) : lines.has(lineKey(e.route))
}

interface Classified {
  kind: ChangeKind
  probable: boolean
  direction: Direction | null
}

/** Part suspended: the stops inside the informed stretch, its two ends excluded (one informed stop is that stop). */
function partSuspendedHere(informed: readonly StationId[], memberIds: ReadonlySet<StationId>, stationById: ReadonlyMap<StationId, Station>): boolean {
  if (informed.length === 1) return memberIds.has(informed[0]!)
  if (informed.length < 3) return false
  const ends = stretchEnds(informed, (id) => stationById.get(id)!.pos)
  return informed.some((id) => memberIds.has(id) && !ends.includes(id))
}

/**
 * What one route of an alert does at the station. `reaching` is that route's entities that concern the station; the
 * skip and part-suspended rules also read every stop the alert lists for the route, not just these.
 */
function classify(
  alert: ServiceAlert,
  route: RouteId,
  reaching: readonly AlertEntity[],
  memberIds: ReadonlySet<StationId>,
  stationById: ReadonlyMap<StationId, Station>,
  serviceOf: ServiceOf | null,
): Classified {
  const direction = sharedDirection(reaching.map((e) => e.direction))
  const other: Classified = { kind: 'other', probable: false, direction }
  const kind = alertKindOf(alert.type)
  const informed = [...new Set(alert.entities.filter((e) => e.route === route && e.stop !== null && stationById.has(e.stop)).map((e) => e.stop!))]
  switch (kind) {
    case 'skip': {
      const set = skipSetsOf(alert, stationById).find((s) => s.route === route)
      if (set && [...memberIds].some((id) => set.stations.has(id))) return { kind: 'skipped', probable: set.probable, direction: set.direction }
      return other
    }
    case 'part':
      return partSuspendedHere(informed, memberIds, stationById) ? { kind: 'suspended', probable: false, direction } : other
    case 'suspended':
      return reaching.length > 0 ? { kind: 'suspended', probable: false, direction } : other
    case 'local': {
      if (serviceOf === null) return other
      const sets = addedSetsOf(alert, { stationById, serviceOf }).filter((s) => s.route === route && [...memberIds].some((id) => s.stations.has(id)))
      if (sets.length === 0) return other
      return { kind: 'added', probable: false, direction: sets.length === 1 ? sets[0]!.direction : null }
    }
    default:
      return other
  }
}

/**
 * Joins the alerts feed to the focused station (a complex: any member's stops). An alert concerns it through an
 * entity at one of its stops, or a whole-route entity of a line it has. Each route of each alert becomes a
 * skipped / suspended / other change, merged by (alert, kind, direction) with its routes in `routeOrder`; the
 * MTA header rides along verbatim. Only alerts in effect or starting within a day count (re-checked here against
 * `nowS`, since the Worker's body is up to minutes old). With no snapshot younger than ALERTS_MAX_AGE_S, or a
 * version mismatch, the panel is `unknown`; two failed polls with nothing yet is also unknown, one is still connecting.
 * An Express to Local change is `added` where it adds a stop (alertAdded.ts, over `normal`, the normal service), and the
 * same alert's `other` rows here in that direction are dropped (the 7 under the 7X at 74 St: one change, one row). While
 * `normal` is `'loading'` it is `other` and the join isn't `known`, so the row turning `added` once it loads is never
 * announced as news; with none coming (null) it is a plain `other` row and the join settles as usual.
 */
export function joinStationChanges(
  group: StationGroup,
  stationById: ReadonlyMap<StationId, Station>,
  input: AlertsInput,
  nowS: number,
  routeOrder: ReadonlyMap<RouteId, number>,
  normal: NormalService,
): ChangesJoin {
  const status = alertsStatus(input, nowS)
  if (status === 'none') return NONE
  const { snapshot } = input
  if (status === 'unknown' || snapshot === null) return { panel: { kind: 'unknown' }, known: false }
  const memberIds: ReadonlySet<StationId> = new Set(group.memberIds)
  const lines = new Set(group.routeIds.map(lineKey))
  const routes = new Set(group.routeIds)
  const rank = (r: RouteId) => routeOrder.get(r) ?? Infinity
  const serviceOf = serviceOrNull(normal)
  const merged = new Map<string, StationChange>()
  let waiting = false
  for (const alert of snapshot.alerts) {
    const period = relevantPeriod(alert, nowS)
    if (period === null) continue
    const kind = alertKindOf(alert.type)
    const exact = kind === 'suspended'
    const reaching = alert.entities.filter((e) => reaches(e, memberIds, lines, routes, exact))
    if (kind === 'local' && normal === 'loading' && reaching.length > 0) waiting = true
    for (const route of new Set(reaching.map((e) => e.route))) {
      const ofRoute = reaching.filter((e) => e.route === route)
      const c = classify(alert, route, ofRoute, memberIds, stationById, serviceOf)
      const wide = ofRoute.every((e) => e.stop === null)
      const key = `${alert.id}|${c.kind}|${c.direction ?? ''}`
      const have = merged.get(key)
      if (have) {
        have.routes = [...have.routes, route].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
        have.probable = have.probable || c.probable
        have.routeWide = have.routeWide && wide
        continue
      }
      merged.set(key, {
        alertId: alert.id,
        kind: c.kind,
        routes: [route],
        direction: c.direction,
        probable: c.probable,
        now: period.now,
        from: !period.now && period.start > 0 ? period.start : null,
        until: period.now ? period.end : null,
        header: alert.header,
        type: alert.type,
        routeWide: wide,
      })
    }
  }
  const added = new Set([...merged.values()].filter((c) => c.kind === 'added').map((c) => `${c.alertId}|${c.direction ?? ''}`))
  const changes = [...merged.values()].filter((c) => !(c.kind === 'other' && added.has(`${c.alertId}|${c.direction ?? ''}`))).sort(
    (a, b) =>
      Number(b.now) - Number(a.now) ||
      Number(a.routeWide) - Number(b.routeWide) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.from ?? 0) - (b.from ?? 0) ||
      (a.alertId < b.alertId ? -1 : a.alertId > b.alertId ? 1 : 0),
  )
  return { panel: changes.length > 0 ? { kind: 'changes', changes } : { kind: 'none' }, known: !waiting }
}
