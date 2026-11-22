import type { EneOutage, EneSnapshot } from '../../data/realtime'
import type { Connector, Level, StationInterior } from '../../data/stationSchema'
import { clockNow } from './clock'

/**
 * An outage snapshot older than this (by the live clock) is unknown, not "all in service": four times the Worker's
 * cache TTL, so a healthy body (at most about 246 s old on screen) never trips it, and a Worker serving a stale
 * body through a long upstream failure does.
 */
export const ENE_MAX_AGE_S = 480

/** Live machine status for one interior. `known` is false with no fresh data: every machine then reads as in service. */
export interface MachineStatus {
  known: boolean
  isOut(connectorId: string): boolean
}

export const NO_MACHINE_STATUS: MachineStatus = { known: false, isOut: () => false }

export interface MachineOutage {
  /** The equipment code, the connector's id. */
  id: string
  kind: 'elevator' | 'escalator'
  /** "Mezzanine to platform": the end nearest the street first. */
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
  status: MachineStatus
  /** Ids of the machines out of service, sorted: the interior's drawing input. */
  outIds: readonly string[]
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

/** "Mezzanine to platform": the end nearest the street (in levels) leads. */
function levelsText(interior: StationInterior, c: Connector): string {
  const street = interior.levels.findIndex((l) => l.kind === 'street')
  const find = (id: string): { level: Level; away: number } => {
    const i = interior.levels.findIndex((l) => l.id === id)
    const level = interior.levels[i]
    if (!level) throw new Error(`Unknown level "${id}" on connector ${c.id}`)
    return { level, away: Math.abs(i - street) }
  }
  const [a, b] = [find(c.upper.level), find(c.lower.level)]
  const [near, far] = a.away <= b.away ? [a, b] : [b, a]
  return `${near.level.name} to ${far.level.name.toLowerCase()}`
}

const NONE: OutageJoin = { panel: { kind: 'none' }, status: NO_MACHINE_STATUS, outIds: [] }

/**
 * Joins the outage feed to the focused interior's machines (elevators and escalators; the equipment code is the
 * connector id). With fresh data, the listed machines are out: `panel` names them (elevators first, then by id),
 * `outIds` feeds the drawing and `status` the step-free routing. Without fresh data (older than ENE_MAX_AGE_S, two
 * failed polls with nothing yet, or a version mismatch) an interior that has machines is `unknown` and nothing reads
 * as out. A machine whose return time has passed stays out: the MTA hasn't said it is back.
 */
export function joinStationOutages(interior: StationInterior | null, ene: EneInput, nowS: number): OutageJoin {
  if (!ene.configured) return NONE
  const known = eneFresh(ene.snapshot, nowS) && !ene.schemaMismatch
  const machines = interior ? interior.connectors.filter(isMachine) : []
  // Nothing to know without machines (an interior still loading counts): `known` stays false, so the panel's
  // announcer doesn't take this for a view of fresh data and speak the machines when the interior arrives.
  if (machines.length === 0) return NONE
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
    status: { known, isOut: (id) => ids.has(id) },
    outIds,
  }
}
