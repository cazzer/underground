/**
 * Where escalators with no plan run of their own are laid, so a bank of them at one point draws as
 * parallel bands rather than one. `.ts` import paths: scripts/lib/stationOutputs.test.ts
 * (nodenext) loads this file.
 */
import type { Connector, Entrance, LocalPoint } from '../data/stationSchema.ts'
import { MIN_RUN, type RunAnchor } from './interiorConnectors.ts'

/** Clear gap between neighboring escalators of one bank, meters. */
export const BANK_GAP_M = 0.3
/**
 * An escalator this close (meters) to the entrance that lists it is on it. The station build copies the
 * entrance point exactly unless an authored `at` moves the machine, so this only absorbs rounding.
 */
export const ON_ENTRANCE_M = 0.05

const distance = (a: LocalPoint, b: LocalPoint) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** An escalator's own anchor point, and whether that point is its listing entrance. */
interface Candidate {
  c: Connector
  point: LocalPoint
  atEntrance: boolean
}

/**
 * Its listing entrance's point when the escalator sits on it, else its own point. The station build
 * lists each connector on at most one entrance (`Entrance.connectors`), so a zero-run escalator listed
 * twice is a data error and throws: its placement would depend on which listing won. No other
 * connector is looked up here.
 */
function candidate(c: Connector, listings: ReadonlyMap<string, Entrance[]>): Candidate {
  const own: LocalPoint = [c.lower.x, c.lower.z]
  const listed = listings.get(c.id) ?? []
  if (listed.length > 1) throw new Error(`Escalator "${c.id}" is listed by entrances ${listed.map((e) => `"${e.id}"`).join(', ')}`)
  const e = listed[0]
  const onEntrance = e !== undefined && distance([e.x, e.z], own) < ON_ENTRANCE_M
  return { c, point: onEntrance ? [e.x, e.z] : own, atEntrance: onEntrance }
}

/** Whether two escalators' bands would touch or overlap if both were drawn at their own points. */
const crowded = (a: Candidate, b: Candidate) => distance(a.point, b.point) < (a.c.width + b.c.width) / 2 + BANK_GAP_M

/** Banks as single-linkage clusters of `crowded` pairs (union-find over all pairs), members in id order. */
function clusters(candidates: readonly Candidate[]): Candidate[][] {
  const parent = candidates.map((_, i) => i)
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i]!)))
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (crowded(candidates[i]!, candidates[j]!)) parent[root(j)] = root(i)
    }
  }
  const byRoot = new Map<number, Candidate[]>()
  // `candidates` is in id order, so each cluster is too.
  candidates.forEach((k, i) => byRoot.set(root(i), [...(byRoot.get(root(i)) ?? []), k]))
  return [...byRoot.values()]
}

/**
 * A `RunAnchor` for every escalator whose ends share one plan point. One on the street entrance that
 * lists it is pinned there by its street end; any other is centered on its own point.
 * Escalators whose bands would touch (points closer than half their widths plus `BANK_GAP_M`) form a
 * bank, transitively. A bank is pinned at its first (by id) pinned member's entrance if it has one,
 * else centered on its first member's point; its members sit side by side across the station axis in
 * id order, `BANK_GAP_M` apart, the bank centered on that point.
 * An authored escalator centered on its own point (an `at` placed it, off any entrance) is never banked:
 * it stays exactly where the author put it.
 */
export function spreadBanks(connectors: readonly Connector[], entrances: readonly Entrance[]): Map<string, RunAnchor> {
  const listings = new Map<string, Entrance[]>()
  for (const e of entrances) for (const id of e.connectors) listings.set(id, [...(listings.get(id) ?? []), e])
  const candidates = connectors
    .filter((c) => c.kind === 'escalator' && Math.hypot(c.upper.x - c.lower.x, c.upper.z - c.lower.z) < MIN_RUN)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => candidate(c, listings))
  const placed = (k: Candidate) => !k.atEntrance && k.c.sources.includes('authored')
  const anchors = new Map<string, RunAnchor>()
  for (const k of candidates.filter(placed)) anchors.set(k.c.id, { point: k.point, atEntrance: false, lateral: 0 })
  for (const members of clusters(candidates.filter((k) => !placed(k)))) {
    const pin = members.find((m) => m.atEntrance) ?? members[0]!
    const span = members.reduce((sum, m) => sum + m.c.width, 0) + BANK_GAP_M * (members.length - 1)
    let edge = -span / 2
    for (const { c } of members) {
      anchors.set(c.id, { point: pin.point, atEntrance: pin.atEntrance, lateral: edge + c.width / 2 })
      edge += c.width + BANK_GAP_M
    }
  }
  return anchors
}
