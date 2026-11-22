import type { EneOutage, EneSnapshot } from '../../data/realtime'
import type { Connector, Level, StationInterior } from '../../data/stationSchema'
import { clockNow } from './clock'

/**
 * An outage snapshot older than this (by the live clock) is unknown, not "all in service": four times the Worker's
 * cache TTL, so a healthy body (at most about 246 s old on screen) never trips it, and a Worker serving a stale
 * body through a long upstream failure does.
 */
export const ENE_MAX_AGE_S = 480


export interface MachineOutage {
  /** The equipment code, the connector's id. */
  id: string
  kind: 'elevator' | 'escalator'
  /**
   * "Mezzanine to platform": the end nearest the street first. An escalator with a known direction of travel names it
   * instead: "Mezzanine up to street", "Street down to mezzanine" (the end it starts at first).
   */
  levels: string
  /** Epoch seconds; null when the MTA gave none. May be past: overdue. */
  returnAt: number | null
}

export type StationOutages =
  /** Not configured, still connecting, the interior has no machines, or fresh data with none of them out. */
  | { kind: 'none' }
  /** The interior has machines and no fresh data says whether they work. */
  | { kind: 'unknown'; kinds: 'elevator' | 'escalator' | 'both' }
  | { kind: 'out'; outages: MachineOutage[] }

export interface OutageJoin {
  panel: StationOutages
  /** Ids of the machines out of service, sorted: the interior's drawing input. */
  outIds: readonly string[]
  /** Fresh data says which of this interior's machines are out (or that none are). False otherwise, whatever the panel shows. */
  known: boolean
  /** What step-free routing may rely on (`closedForRouting`). */
  closed: ReadonlySet<string> | null
}

/**
 * The connector ids a route must avoid (`chooseExit`'s and `routesToStreet`'s `closed`), or null when machine status is
 * unknown (stale, missing or mismatched data): callers must then say step-free status is unknown, never treat every
 * machine as working. An interior with no machines has nothing to close: an empty set.
 */
export function closedForRouting(join: OutageJoin): ReadonlySet<string> | null {
  return join.closed
}

/** The part of useEne's feed the join reads (this module doesn't import src/data/useEne). */
export interface EneInput {
  configured: boolean
  snapshot: EneSnapshot | null
  byCode: ReadonlyMap<string, EneOutage> | null
  failures: number
  schemaMismatch: boolean
}

/** Epoch seconds: the /rt live clock when there is one, else the device clock. */
export function eneNowS(offsetS: number | null, perfMs: number, wallMs: number): number {
  return offsetS === null ? wallMs / 1000 : clockNow(offsetS, perfMs)
}

export function eneFresh(snapshot: EneSnapshot | null, nowS: number): boolean {
  return snapshot !== null && nowS - snapshot.generatedAt <= ENE_MAX_AGE_S
}

type Machine = Connector & { kind: 'elevator' | 'escalator' }
const isMachine = (c: Connector): c is Machine => c.kind === 'elevator' || c.kind === 'escalator'

/** First words of a level name that is a common noun or an adjective, not a proper name ("Street", "Upper mezzanine"). */
const GENERIC_LEVEL_WORDS: ReadonlySet<string> = new Set([
  'street', 'mezzanine', 'platform', 'platforms', 'concourse', 'station', 'upper', 'lower', 'intermediate', 'main',
  'balcony', 'underpass', 'passageway', 'entrance',
])

/** A level name inside a sentence: a generic leading word loses its capital ("Street" to "street"), a proper name keeps it ("Canarsie platform"). */
function midSentence(name: string): string {
  const first = name.split(' ')[0]!.toLowerCase()
  return GENERIC_LEVEL_WORDS.has(first) ? name.charAt(0).toLowerCase() + name.slice(1) : name
}

/**
 * "Mezzanine to platform": the end nearest the street (in levels) leads. An escalator with `travel` leads with the end
 * it starts at and says the way it goes ("Mezzanine up to street", "Street down to mezzanine"); elevators and
 * escalators without `travel` keep the street-first wording.
 */
function levelsText(interior: StationInterior, c: Connector): string {
  const street = interior.levels.findIndex((l) => l.kind === 'street')
  const find = (id: string): { level: Level; away: number } => {
    const i = interior.levels.findIndex((l) => l.id === id)
    const level = interior.levels[i]
    if (!level) throw new Error(`Unknown level "${id}" on connector ${c.id}`)
    return { level, away: Math.abs(i - street) }
  }
  const [a, b] = [find(c.upper.level), find(c.lower.level)]
  if (c.kind === 'escalator' && c.travel) {
    const [from, to] = c.travel === 'up' ? [b, a] : [a, b]
    return `${from.level.name} ${c.travel} to ${midSentence(to.level.name)}`
  }
  const [near, far] = a.away <= b.away ? [a, b] : [b, a]
  return `${near.level.name} to ${midSentence(far.level.name)}`
}

const NONE: OutageJoin = { panel: { kind: 'none' }, outIds: [], known: false, closed: null }
/** No machines, so no outage can matter to a route; still not `known` (nothing was learned about any machine). */
const NO_MACHINES: OutageJoin = { ...NONE, closed: new Set() }

/**
 * Joins the outage feed to the focused interior's machines (elevators and escalators; the equipment code is the
 * connector id). With fresh data, the listed machines are out: `panel` names them (elevators first, then by id),
 * `outIds` feeds the drawing and `closedForRouting` the step-free routing. Without fresh data (older than ENE_MAX_AGE_S, two
 * failed polls with nothing yet, or a version mismatch) an interior that has machines is `unknown` and nothing reads
 * as out. A machine whose return time has passed stays out: the MTA hasn't said it is back.
 */
export function joinStationOutages(interior: StationInterior | null, ene: EneInput, nowS: number): OutageJoin {
  const machines = interior ? interior.connectors.filter(isMachine) : []
  if (interior && machines.length === 0) return NO_MACHINES
  if (!ene.configured) return NONE
  const known = eneFresh(ene.snapshot, nowS) && !ene.schemaMismatch
  // No interior yet: `known` stays false, so the panel's announcer doesn't take this for a view of fresh data and
  // speak the machines when the interior arrives.
  if (interior === null) return NONE
  if (!known) {
    // No snapshot yet and fewer than two failures is still connecting, which shows nothing.
    if (ene.snapshot === null && ene.failures < 2 && !ene.schemaMismatch) return NONE
    const kinds = new Set(machines.map((m) => m.kind))
    return { ...NONE, panel: { kind: 'unknown', kinds: kinds.size === 2 ? 'both' : kinds.has('elevator') ? 'elevator' : 'escalator' } }
  }
  const out = machines
    .filter((m) => ene.byCode?.has(m.id))
    .map((m): MachineOutage => ({ id: m.id, kind: m.kind, levels: levelsText(interior!, m), returnAt: ene.byCode!.get(m.id)!.returnAt }))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'elevator' ? -1 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const outIds = out.map((o) => o.id).sort()
  const ids = new Set(outIds)
  return {
    panel: out.length > 0 ? { kind: 'out', outages: out } : { kind: 'none' },
    outIds,
    known,
    closed: ids,
  }
}
