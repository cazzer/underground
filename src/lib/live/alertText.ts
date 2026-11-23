import type { Direction, RouteId, StationId } from '../../data/schema'
import { routeSpokenName } from '../labels'
import type { Route } from '../network'
import type { StationGroup } from '../stationGroups'
import type { ChangeKind, ChangesJoin, StationChange } from './alertJoin'
import { nyWhen } from './nyWhen'
import type { TerminalOf } from './routeTerminals'

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
  /** The row's sentence for a screen reader: "The 1 train skips this station, downtown only, until 7:45 AM." */
  spoken: string
  /** What is said when the row goes away: "The skip for the 1 train at this station has ended." */
  ended: string
}

export type ServiceChangeBody =
  | { kind: 'none' }
  | { kind: 'unknown'; text: string }
  | { kind: 'changes'; rows: ChangeRow[] }

export interface ServiceChangeView {
  /** Fresh data says what changes here (or that nothing does): the only time a change is news. */
  known: boolean
  body: ServiceChangeBody
  /** "The downtown 1 train skips this station now.": only for a skip in effect that the header names (never a guess); else "". */
  skipSpoken: string
}

export const UNKNOWN_TEXT = 'Service changes unavailable'

/** Not north-south lines: the GTFS N/S of these are not uptown and downtown even in Manhattan. */
const CROSSTOWN: ReadonlySet<RouteId> = new Set(['L', '7', '7X', 'GS', 'FS', 'H', 'J', 'Z'])

/** The one direction word that never changes with the station's data. */
const ONE_DIRECTION = 'one direction'

/**
 * Where trains of `route` going `direction` are headed, in words. GTFS N and S are track directions, not compass
 * ones: uptown and downtown only for a north-south line at a Manhattan station (not the L, 7, J, Z or the shuttles), else "<terminal>-bound" ("Flushing-bound",
 * "Canarsie-bound"), the end of the line at this station from the startup data (`routeTerminals.ts`), else null (not found, or
 * branches part here).
 */
function directionWord(d: Direction, route: RouteId, ctx: Pick<Context, 'manhattan' | 'terminalOf' | 'memberIds'>): string | null {
  if (ctx.manhattan && !CROSSTOWN.has(route)) return d === 'N' ? 'uptown' : 'downtown'
  const terminal = ctx.terminalOf(route, d, ctx.memberIds)
  return terminal === null ? null : `${terminal}-bound`
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** "1", "1 and 2", "A, C and E" (an express as "7 express"). */
function routeList(routes: readonly RouteId[], routeById: ReadonlyMap<RouteId, Route>): string {
  const names = routes.map((id) => routeSpokenName(routeById.get(id)?.shortName ?? id))
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** "the 1 train" for one route, "A, C and E trains" for several (the verb takes "skips" and "skip" with them). */
function nounOf(routes: readonly RouteId[], routeById: ReadonlyMap<RouteId, Route>, word = ''): string {
  const w = word === '' ? '' : `${word} `
  return routes.length === 1 ? `the ${w}${routeList(routes, routeById)} train` : `${w}${routeList(routes, routeById)} trains`
}

/** What an alert type is, in our words, for a change that isn't a skip or a suspension; "service change" when we can't say. */
export function typeWord(type: string | null): string {
  if (type === null) return 'service change'
  if (/delay/i.test(type)) return 'delays'
  if (/reduced/i.test(type)) return 'reduced service'
  if (/boarding/i.test(type)) return 'boarding change'
  if (/station notice/i.test(type)) return 'station notice'
  return 'service change'
}

interface Context {
  manhattan: boolean
  /** The focused station's members: a branch's end depends on the station. */
  memberIds: readonly StationId[]
  terminalOf: TerminalOf
  routeById: ReadonlyMap<RouteId, Route>
  nowS: number
}

/** "downtown only", "Flushing-bound only", "Coney Island-bound and Church Av-bound only", or "one direction only". */
function directionPart(c: StationChange, ctx: Context): string | null {
  if (c.direction === null) return null
  const words = [...new Set(c.routes.map((r) => directionWord(c.direction!, r, ctx)).filter((w) => w !== null))]
  return `${words.length === 0 ? ONE_DIRECTION : words.join(' and ')} only`
}

function rowParts(c: StationChange, ctx: Context): string[] {
  const many = c.routes.length > 1
  const head = c.kind === 'skipped' ? `${c.probable ? 'probably ' : ''}${many ? 'skip' : 'skips'} this station` : c.kind === 'suspended' ? 'no service here' : typeWord(c.type)
  const parts = [head]
  const direction = directionPart(c, ctx)
  if (direction !== null) parts.push(direction)
  if (c.now && c.until !== null) parts.push(`until ${nyWhen(c.until, ctx.nowS)}`)
  if (!c.now && c.from !== null) parts.push(`from ${nyWhen(c.from, ctx.nowS)}`)
  return parts
}

/** "The 1 train skips this station, downtown only, until 7:45 AM." / "Delays for B and D trains." */
function rowSpoken(c: StationChange, parts: readonly string[], ctx: Context): string {
  const noun = nounOf(c.routes, ctx.routeById)
  const many = c.routes.length > 1
  const lead =
    c.kind === 'skipped' ? `${noun} ${parts[0]}` : c.kind === 'suspended' ? `${noun} ${many ? 'have' : 'has'} no service here` : `${capital(parts[0]!)} for ${noun}`
  return `${capital(lead)}${parts.length > 1 ? `, ${parts.slice(1).join(', ')}` : ''}.`
}

/** "The skip for the 1 train at this station has ended." ("suspension", or "service change" for any other kind: no plural to agree with). */
function rowEnded(c: StationChange, ctx: Context): string {
  const what = c.kind === 'skipped' ? 'skip' : c.kind === 'suspended' ? 'suspension' : 'service change'
  return `The ${what} for ${nounOf(c.routes, ctx.routeById)} at this station has ended.`
}

/**
 * The sentence the heading adds: skips in effect that the header names, grouped by direction word so each route
 * is said with its own ("The downtown 1 train skips this station now."). A guess is never said.
 */
function skipSentences(changes: readonly StationChange[], ctx: Context): string {
  const groups = new Map<string, { word: string | null; routes: RouteId[] }>()
  for (const c of changes) {
    if (c.kind !== 'skipped' || !c.now || c.probable) continue
    for (const route of c.routes) {
      const word = c.direction === null ? '' : (directionWord(c.direction, route, ctx) ?? null)
      const key = word ?? ONE_DIRECTION
      const g = groups.get(key) ?? { word, routes: [] }
      g.routes.push(route)
      groups.set(key, g)
    }
  }
  return [...groups.values()]
    .map((g) => {
      const noun = nounOf(g.routes, ctx.routeById, g.word ?? '')
      return capital(`${noun} ${g.routes.length > 1 ? 'skip' : 'skips'} this station${g.word === null ? ' in one direction' : ''} now.`)
    })
    .join(' ')
}

/**
 * What the station panel shows for a join, as of `nowS`: a row per change (our short line over the MTA's header)
 * and the sentence the heading adds when this station is skipped right now. `terminalOf` words a direction where
 * uptown and downtown would be wrong.
 */
export function serviceChangeView(
  join: ChangesJoin,
  group: StationGroup,
  routeById: ReadonlyMap<RouteId, Route>,
  nowS: number,
  terminalOf: TerminalOf,
): ServiceChangeView {
  const { panel, known } = join
  if (panel.kind === 'none') return { known, body: { kind: 'none' }, skipSpoken: '' }
  if (panel.kind === 'unknown') return { known, body: { kind: 'unknown', text: UNKNOWN_TEXT }, skipSpoken: '' }
  const ctx: Context = { manhattan: group.borough === 'M', memberIds: group.memberIds, terminalOf, routeById, nowS }
  const rows = panel.changes.map((c): ChangeRow => {
    const parts = rowParts(c, ctx)
    return {
      key: `${c.alertId}|${c.kind}|${c.direction ?? ''}`,
      kind: c.kind,
      routes: c.routes,
      now: c.now,
      parts,
      header: c.header,
      spoken: rowSpoken(c, parts, ctx),
      ended: rowEnded(c, ctx),
    }
  })
  return { known, body: { kind: 'changes', rows }, skipSpoken: skipSentences(panel.changes, ctx) }
}
