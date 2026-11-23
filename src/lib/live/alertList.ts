import type { RouteId } from '../../data/schema'
import { addDays, nyDate } from '../realtime/serviceDate'
import { alertsStatus, relevantPeriod, type AlertsInput } from './alertJoin'
import { lineKey } from './lineFilter'
import { nyTime, nyWhen } from './nyWhen'

/** One service change in the header's list: the MTA's header verbatim over the routes it is about and when. */
export interface AlertListRow {
  id: string
  /** Lines (an express folded into its line), deduped, in route order; ids the network lacks last, sorted. */
  routeIds: string[]
  /** The MTA's header, verbatim: a plain text node, never edited, truncated or re-cased. */
  header: string
  /** "Now", "Now · until 11:45 PM", "Tonight 11:45 PM", "Tomorrow 4 AM": New York time. */
  when: string
  /** The sort key: the end of the period in effect (null: open-ended), or the start of the next. */
  atS: number | null
}

export type AlertListBody =
  /** Not configured: no chip, no panel content. */
  | { kind: 'off' }
  | { kind: 'connecting' }
  /** No fresh data says what changes: never "none". */
  | { kind: 'unknown' }
  | { kind: 'list'; now: AlertListRow[]; later: AlertListRow[] }

export interface AlertChip {
  text: string
  /** A change is in effect or coming: the chip carries a warning swatch (never the only cue: the text is the count). */
  mark: boolean
}

const NY_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: 'numeric' })

/** From this New York hour on, a start later today is "Tonight". */
const EVENING_HOUR = 18

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * When a change that hasn't started yet starts, by New York days: "Today 2:30 PM", "Tonight 11:45 PM" (from 6 PM),
 * "Tomorrow 4 AM"; beyond that (a day an hour short or long can't reach it, but the function doesn't assume) the
 * station panel's wording, capitalised.
 */
export function laterWhen(startS: number, nowS: number): string {
  const day = nyDate(startS)
  const today = nyDate(nowS)
  if (day === today) {
    const hour = Number(NY_HOUR.formatToParts(startS * 1000).find((p) => p.type === 'hour')!.value)
    return `${hour >= EVENING_HOUR ? 'Tonight' : 'Today'} ${nyTime(startS)}`
  }
  if (day === addDays(today, 1)) return `Tomorrow ${nyTime(startS)}`
  return capital(nyWhen(startS, nowS))
}

function routesOf(entities: readonly { route: string }[], routeOrder: ReadonlyMap<RouteId, number>): string[] {
  const lines = [...new Set(entities.map((e) => lineKey(e.route)))]
  const rank = (r: string) => routeOrder.get(r) ?? Infinity
  return lines.sort((a, b) => (rank(a) === rank(b) ? (a < b ? -1 : a > b ? 1 : 0) : rank(a) - rank(b)))
}

const byId = (a: AlertListRow, b: AlertListRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * The header's list as of `nowS`: every alert in effect (Now) or starting within the window (Later today), each once,
 * under the same freshness rule as the station panel (`alertsStatus`). An alert in effect stays "Now" however many
 * later periods it has; one that isn't takes its earliest start.
 */
export function alertListView(alerts: AlertsInput, routeOrder: ReadonlyMap<RouteId, number>, nowS: number): AlertListBody {
  if (!alerts.configured) return { kind: 'off' }
  const status = alertsStatus(alerts, nowS)
  if (status === 'none') return { kind: 'connecting' }
  if (status === 'unknown' || alerts.snapshot === null) return { kind: 'unknown' }
  const now: AlertListRow[] = []
  const later: AlertListRow[] = []
  for (const alert of alerts.snapshot.alerts) {
    const period = relevantPeriod(alert, nowS)
    if (period === null) continue
    const routeIds = routesOf(alert.entities, routeOrder)
    const base = { id: alert.id, routeIds, header: alert.header }
    if (period.now) {
      const when = period.end === null ? 'Now' : `Now · until ${nyWhen(period.end, nowS)}`
      now.push({ ...base, when, atS: period.end })
    } else later.push({ ...base, when: laterWhen(period.start, nowS), atS: period.start })
  }
  const first = (r: AlertListRow) => routeOrder.get(r.routeIds[0] ?? '') ?? Infinity
  now.sort((a, b) => first(a) - first(b) || byId(a, b))
  later.sort((a, b) => (a.atS ?? 0) - (b.atS ?? 0) || first(a) - first(b) || byId(a, b))
  return { kind: 'list', now, later }
}

const count = (n: number) => `${n} service change${n === 1 ? '' : 's'}`

/**
 * The header chip for a body: how many are in effect, else how many are coming, or the unavailable state. Null when
 * there is nothing to say (not configured; connecting or an empty list while the panel is closed). `open` is the
 * panel being open, which keeps the chip as its toggle even when there is nothing to list. The count is for the eye:
 * the chip is no live region and no poll speaks it.
 */
export function alertChip(body: AlertListBody, open: boolean): AlertChip | null {
  switch (body.kind) {
    case 'off':
      return null
    case 'connecting':
      return open ? { text: 'Service changes', mark: false } : null
    case 'unknown':
      return { text: 'Service changes unavailable', mark: false }
    case 'list':
      if (body.now.length > 0) return { text: count(body.now.length), mark: true }
      if (body.later.length > 0) return { text: `${count(body.later.length)} later`, mark: true }
      return open ? { text: 'No service changes', mark: false } : null
  }
}
