/**
 * The way from one platform track to another inside a station complex, over the interior route graph
 * (interiorGraphCore.ts) in transfer mode: never through the street or a slab marked unpaid, since leaving fare control
 * costs a new fare. A slab that doesn't say counts as inside fare control, and the route is then only probable. Pure.
 */
import type { StopId } from '../data/schema'
import type { LocalPoint, StationInterior } from '../data/stationSchema'
import { buildInteriorGraph, pathBack, shortestFrom, STEP_FREE_KINDS, stopTracks, type StopTrack } from './interiorGraphCore'
import { nearestOnPolyline } from './planGeometry'
import { WALK_SPEED_MPS } from './walkRoute'

export interface TransferRoute {
  /** Track to track. The walks along both platforms are not costed (as for exits), so this understates on a long one. */
  seconds: number
  /** In travel order; empty for a change across one platform. */
  connectorIds: string[]
  /** The alighting platform first, then each slab or platform stood on, the boarding platform last. */
  areaIds: string[]
  /** Every connector taken is an elevator, ramp or walkway. */
  stepFree: boolean
  /** Some slab stood on doesn't say whether it is inside fare control; it is assumed to be. */
  paidAssumed: boolean
}

export interface TransferChoice extends Omit<TransferRoute, 'seconds'> {
  kind: 'transfer'
  /** The child stop the rider steps off at (the same field as an ExitChoice's). */
  stopId: StopId
  /** The child stop the next train leaves from. */
  toStopId: StopId
  /** The layout is estimated (generated, or authored `approximate`) or a slab's fare control is assumed. */
  probable: boolean
  inStationS: number
  /** A step-free way, when the quickest one has steps and there is one; null otherwise. */
  stepFreeAlt: TransferRoute | null
  /** Why the quickest way, which has steps, has no step-free alternative: none in the layout at all, or only machines
   *  out of service broke it. Null when there is one, or the quickest is step-free. */
  noStepFree: 'layout' | 'outage' | null
}

export type TransferResult = TransferChoice | { kind: 'none'; reason: 'no-track' | 'no-route' }

export interface TransferOptions {
  stepFree?: boolean
  /** Connector ids out of service. */
  closed?: ReadonlySet<string>
}

/** Least distance between two polylines, by their vertices against each other (enough for platform tracks). */
function trackGap(a: readonly LocalPoint[], b: readonly LocalPoint[]): number {
  let best = Infinity
  for (const p of a) best = Math.min(best, nearestOnPolyline(b, p).distance)
  for (const p of b) best = Math.min(best, nearestOnPolyline(a, p).distance)
  return best
}

function paidAssumedOf(interior: StationInterior, areaIds: readonly string[]): boolean {
  return interior.slabs.some((s) => s.paid === undefined && areaIds.includes(s.id))
}

function routeOf(interior: StationInterior, seconds: number, connectorIds: string[], areaIds: string[]): TransferRoute {
  const kinds = connectorIds.map((id) => interior.connectors.find((c) => c.id === id)!.kind)
  return { seconds, connectorIds, areaIds, stepFree: kinds.every((k) => STEP_FREE_KINDS.has(k)), paidAssumed: paidAssumedOf(interior, areaIds) }
}

/** Across one platform that holds both stops: the walk between their tracks. Null when no platform holds both. */
function acrossPlatform(interior: StationInterior, from: readonly StopTrack[], to: readonly StopTrack[]): TransferRoute | null {
  let best: { platform: string; s: number } | null = null
  for (const a of from) {
    for (const b of to) {
      if (a.platform !== b.platform) continue
      const s = trackGap(a.path, b.path) / WALK_SPEED_MPS
      if (!best || s < best.s) best = { platform: a.platform, s }
    }
  }
  return best && routeOf(interior, best.s, [], [best.platform])
}

/**
 * The quickest transfer from a track of `fromStop` to a track of `toStop`, inside fare control. `no-track` when either
 * stop has no platform track here; null when no route stays inside (or, step-free, none has no steps).
 */
export function transferRoute(interior: StationInterior, fromStop: StopId, toStop: StopId, opts: TransferOptions = {}): TransferRoute | 'no-track' | null {
  const from = stopTracks(interior, fromStop)
  const to = stopTracks(interior, toStop)
  if (from.length === 0 || to.length === 0) return 'no-track'
  const across = acrossPlatform(interior, from, to)
  if (across) return across
  const graph = buildInteriorGraph(interior, { ...opts, transfer: true })
  const { nodes, connectorNodes } = graph
  // One sink: each connector end on a platform the next train leaves from walks to its nearest track there.
  const sink = graph.addNode([0, 0], null)
  for (let n = 0; n < connectorNodes; n++) {
    let best = Infinity
    for (const t of to) if (nodes[n]!.area === t.platform) best = Math.min(best, nearestOnPolyline(t.path, nodes[n]!.point).distance)
    if (best < Infinity) graph.link(n, sink, best / WALK_SPEED_MPS, null)
  }
  const search = shortestFrom(graph, from)
  if (search.d[sink]! === Infinity) return null
  const { connectorIds, areaIds } = pathBack(graph, search, sink)
  return routeOf(interior, search.d[sink]!, connectorIds, areaIds)
}

/** The quickest transfer, and a step-free one when the quickest has steps. Closed connectors are left out of both. */
export function chooseTransfer(input: { interior: StationInterior; fromStop: StopId; toStop: StopId; closed?: ReadonlySet<string> }): TransferResult {
  const { interior, fromStop, toStop, closed } = input
  const shortest = transferRoute(interior, fromStop, toStop, { closed })
  if (shortest === 'no-track') return { kind: 'none', reason: 'no-track' }
  if (shortest === null) return { kind: 'none', reason: 'no-route' }
  const found = (r: TransferRoute | 'no-track' | null): TransferRoute | null => (r === null || r === 'no-track' ? null : r)
  const alt = shortest.stepFree ? null : found(transferRoute(interior, fromStop, toStop, { closed, stepFree: true }))
  // Without the closures, is there one? Then an outage removed it; otherwise the layout has none.
  const anyAlt = shortest.stepFree || alt !== null || closed === undefined || closed.size === 0 ? alt : found(transferRoute(interior, fromStop, toStop, { stepFree: true }))
  const noStepFree = shortest.stepFree || alt !== null ? null : anyAlt !== null ? 'outage' : 'layout'
  const { seconds, ...route } = shortest
  return {
    ...route,
    kind: 'transfer',
    stopId: fromStop,
    toStopId: toStop,
    probable: interior.generated !== undefined || interior.approximate === true || shortest.paidAssumed,
    inStationS: seconds,
    stepFreeAlt: alt,
    noStepFree,
  }
}
