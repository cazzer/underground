import { ALERT_WINDOW_S, type AlertEntity, type AlertsSnapshot, type ServiceAlert } from '../../data/realtime'
import type { Direction, RouteId, StationId } from '../../data/schema'
import type { Station } from '../network'
import type { StationGroup } from '../stationGroups'
import { alertKindOf, sharedDirection, skipSetsOf, stretchEnds } from './alertStations'
import { lineKey } from './lineFilter'

/**
 * An alerts snapshot older than this (by the live clock) is unknown, not "no service changes": four times the
 * Worker's cache TTL, as for outages (`ENE_MAX_AGE_S`).
 */
export const ALERTS_MAX_AGE_S = 480

/** The part of useAlerts' feed the join reads (this module doesn't import src/data/useAlerts). */
export interface AlertsInput {
  configured: boolean
  snapshot: AlertsSnapshot | null
  failures: number
  schemaMismatch: boolean
}

/** What a change does at this station: trains skip it, there is no service here, or a notice we only quote. */
export type ChangeKind = 'skipped' | 'suspended' | 'other'

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

const NONE: ChangesJoin = { panel: { kind: 'none' }, known: false }
const KIND_ORDER: Record<ChangeKind, number> = { skipped: 0, suspended: 1, other: 2 }

/** The period of `alert` in effect at `nowS`, else the next one starting within the window; null when neither. */
function relevantPeriod(alert: ServiceAlert, nowS: number): { now: boolean; start: number; end: number | null } | null {
  let next: { now: boolean; start: number; end: number | null } | null = null
  for (const [start, end] of alert.periods) {
    if (end !== null && end <= nowS) continue
    if (start <= nowS) return { now: true, start, end }
    if (start < nowS + ALERT_WINDOW_S && (next === null || start < next.start)) next = { now: false, start, end }
  }
  return next
}

/** Whether an entity concerns the station: its stop is a member's, or it names a whole route the station has a line of. */
function reaches(e: AlertEntity, memberIds: ReadonlySet<StationId>, lines: ReadonlySet<string>): boolean {
  return e.stop === null ? lines.has(lineKey(e.route)) : memberIds.has(e.stop)
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
 */
export function joinStationChanges(
  group: StationGroup,
  stationById: ReadonlyMap<StationId, Station>,
  input: AlertsInput,
  nowS: number,
  routeOrder: ReadonlyMap<RouteId, number>,
): ChangesJoin {
  if (!input.configured) return NONE
  const { snapshot } = input
  const fresh = snapshot !== null && nowS - snapshot.generatedAt <= ALERTS_MAX_AGE_S && !input.schemaMismatch
  if (!fresh) {
    if (snapshot === null && input.failures < 2 && !input.schemaMismatch) return NONE
    return { panel: { kind: 'unknown' }, known: false }
  }
  const memberIds: ReadonlySet<StationId> = new Set(group.memberIds)
  const lines = new Set(group.routeIds.map(lineKey))
  const rank = (r: RouteId) => routeOrder.get(r) ?? Infinity
  const merged = new Map<string, StationChange>()
  for (const alert of snapshot.alerts) {
    const period = relevantPeriod(alert, nowS)
    if (period === null) continue
    const reaching = alert.entities.filter((e) => reaches(e, memberIds, lines))
    for (const route of new Set(reaching.map((e) => e.route))) {
      const c = classify(alert, route, reaching.filter((e) => e.route === route), memberIds, stationById)
      const key = `${alert.id}|${c.kind}|${c.direction ?? ''}`
      const have = merged.get(key)
      if (have) {
        have.routes = [...have.routes, route].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
        have.probable = have.probable || c.probable
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
      })
    }
  }
  const changes = [...merged.values()].sort(
    (a, b) =>
      Number(b.now) - Number(a.now) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.from ?? 0) - (b.from ?? 0) ||
      (a.alertId < b.alertId ? -1 : a.alertId > b.alertId ? 1 : 0),
  )
  return { panel: changes.length > 0 ? { kind: 'changes', changes } : { kind: 'none' }, known: true }
}
