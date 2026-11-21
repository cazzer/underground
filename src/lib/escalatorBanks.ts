/**
 * Where escalators with no plan run of their own are laid, so a bank of them at one point draws as
 * parallel bands rather than one. `.ts` import paths: scripts/lib/interiorRegistry.test.ts
 * (nodenext) loads this file.
 */
import type { Connector, Entrance, LocalPoint } from '../data/stationSchema.ts'
import { MIN_RUN, type RunAnchor } from './interiorConnectors.ts'

/** Clear gap between neighboring escalators of one bank, meters. */
export const BANK_GAP_M = 0.3

/**
 * The street entrance point that lists each connector. The station build writes every connector
 * into at most one entrance, so a connector listed twice is a data error and throws.
 */
function entrancePoints(entrances: readonly Entrance[]): Map<string, LocalPoint> {
  const points = new Map<string, LocalPoint>()
  const listedBy = new Map<string, string>()
  for (const e of entrances) {
    for (const id of e.connectors) {
      const first = listedBy.get(id)
      if (first !== undefined) throw new Error(`Connector "${id}" is listed by entrances "${first}" and "${e.id}"`)
      listedBy.set(id, e.id)
      points.set(id, [e.x, e.z])
    }
  }
  return points
}

/**
 * A `RunAnchor` for every escalator whose ends share one plan point. One whose point is on the
 * street entrance that lists it (within MIN_RUN) is pinned there by its street end; any other,
 * including one moved off its entrance by an authored `at`, is centered on its own point.
 * Escalators sharing an anchor point form a bank: side by side across the station axis in id
 * order, `BANK_GAP_M` apart, the bank centered on the point.
 */
export function spreadBanks(connectors: readonly Connector[], entrances: readonly Entrance[]): Map<string, RunAnchor> {
  const entranceOf = entrancePoints(entrances)
  const banks = new Map<string, { point: LocalPoint; atEntrance: boolean; members: Connector[] }>()
  for (const c of connectors) {
    if (c.kind !== 'escalator' || Math.hypot(c.upper.x - c.lower.x, c.upper.z - c.lower.z) >= MIN_RUN) continue
    const own: LocalPoint = [c.lower.x, c.lower.z]
    const e = entranceOf.get(c.id)
    const atEntrance = e !== undefined && Math.hypot(e[0] - own[0], e[1] - own[1]) < MIN_RUN
    const point = atEntrance ? e : own
    const key = `${atEntrance ? 'entrance' : 'point'} ${point[0]} ${point[1]}`
    const bank = banks.get(key)
    if (bank) bank.members.push(c)
    else banks.set(key, { point, atEntrance, members: [c] })
  }
  const anchors = new Map<string, RunAnchor>()
  for (const { point, atEntrance, members } of banks.values()) {
    members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const span = members.reduce((sum, c) => sum + c.width, 0) + BANK_GAP_M * (members.length - 1)
    let edge = -span / 2
    for (const c of members) {
      anchors.set(c.id, { point, atEntrance, lateral: edge + c.width / 2 })
      edge += c.width + BANK_GAP_M
    }
  }
  return anchors
}
