import type { Direction, RouteId } from '../../data/schema'
import { routeSpokenName } from '../labels'
import type { Route } from '../network'
import type { StationGroup } from '../stationGroups'
import type { ChangeKind, ChangesJoin, StationChange } from './alertJoin'
import { nyWhen } from './nyWhen'

export interface ChangeRow {
  /** Stable across polls: the alert, what it does here and the direction. */
  key: string
  kind: ChangeKind
  routes: readonly RouteId[]
  /** In effect now. */
  now: boolean
  /** Our derived line, "skips this station · downtown only · until 7:45 AM": the parts are kept whole. */
  parts: readonly string[]
  /** The MTA's header, verbatim: shown as plain text under our line. */
  header: string
  /** The row's sentence for a screen reader: the routes, then the line. */
  spoken: string
}

export type ServiceChangeBody =
  | { kind: 'none' }
  | { kind: 'unknown'; text: string }
  | { kind: 'changes'; rows: ChangeRow[] }

export interface ServiceChangeView {
  /** Fresh data says what changes here (or that nothing does): the only time a change is news. */
  known: boolean
  body: ServiceChangeBody
  /** "Downtown 1 trains skip this station now.": only for a skip in effect that the header names (never a guess); else "". */
  skipSpoken: string
}

export const UNKNOWN_TEXT = 'Service changes unavailable'

/** Direction words: a Manhattan station reads in uptown and downtown, anywhere else north and south. */
function directionWord(d: Direction, manhattan: boolean): string {
  return d === 'N' ? (manhattan ? 'Uptown' : 'Northbound') : manhattan ? 'Downtown' : 'Southbound'
}

/** "1", "1 and 2", "A, C and E" (an express as "7 express"). */
function routeList(routes: readonly RouteId[], routeById: ReadonlyMap<RouteId, Route>): string {
  const names = routes.map((id) => routeSpokenName(routeById.get(id)?.shortName ?? id))
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const HEAD: Record<ChangeKind, (probable: boolean) => string> = {
  skipped: (probable) => (probable ? 'probably skips this station' : 'skips this station'),
  suspended: () => 'no service here',
  other: () => 'service change',
}

function rowParts(c: StationChange, manhattan: boolean, nowS: number): string[] {
  const parts = [HEAD[c.kind](c.probable)]
  if (c.direction !== null) parts.push(`${directionWord(c.direction, manhattan).toLowerCase()} only`)
  if (c.now && c.until !== null) parts.push(`until ${nyWhen(c.until, nowS)}`)
  if (!c.now && c.from !== null) parts.push(`from ${nyWhen(c.from, nowS)}`)
  return parts
}

/**
 * What the station panel shows for a join, as of `nowS`: a row per change (our short line over the MTA's header)
 * and the one sentence the heading adds when this station is skipped right now.
 */
export function serviceChangeView(join: ChangesJoin, group: StationGroup, routeById: ReadonlyMap<RouteId, Route>, nowS: number): ServiceChangeView {
  const { panel, known } = join
  if (panel.kind === 'none') return { known, body: { kind: 'none' }, skipSpoken: '' }
  if (panel.kind === 'unknown') return { known, body: { kind: 'unknown', text: UNKNOWN_TEXT }, skipSpoken: '' }
  const manhattan = group.borough === 'M'
  const rows = panel.changes.map((c): ChangeRow => {
    const parts = rowParts(c, manhattan, nowS)
    return {
      key: `${c.alertId}|${c.kind}|${c.direction ?? ''}`,
      kind: c.kind,
      routes: c.routes,
      now: c.now,
      parts,
      header: c.header,
      spoken: `${routeList(c.routes, routeById)}: ${parts.join(', ')}.`,
    }
  })
  const sentences: string[] = []
  for (const direction of [null, 'N', 'S'] as const) {
    const skipped = panel.changes.filter((c) => c.kind === 'skipped' && c.now && !c.probable && c.direction === direction)
    if (skipped.length === 0) continue
    const routes = [...new Set(skipped.flatMap((c) => c.routes))]
    const who = `${direction === null ? '' : `${directionWord(direction, manhattan)} `}${routeList(routes, routeById)} trains`
    sentences.push(`${who} skip this station now.`)
  }
  return { known, body: { kind: 'changes', rows }, skipSpoken: sentences.join(' ') }
}
