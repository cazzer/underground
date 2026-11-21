import { segmentKey } from '../../data/codec'
import type { Arrival, VehicleStatus } from '../../data/realtime'
import type { StopId } from '../../data/schema'
import type { Ground } from '../projection'
import { pointAtDistance } from './polyline'
import type { ShapeGeometry } from './shapeGeometry'

/** Run time guess (m/s) for a stop pair missing from segments.json. */
export const FALLBACK_SPEED_MPS = 8
/** Floor on the fallback run time, so very short hops don't teleport. */
export const MIN_RUN_S = 30
/** INCOMING_AT means "about to arrive": never show it less than this far along the hop. */
export const INCOMING_MIN_FRACTION = 0.75

export interface PositionInput {
  geometry: ShapeGeometry
  status: VehicleStatus | null
  stopId: StopId | null
  arrivals: readonly Arrival[]
  segments: Readonly<Record<string, number>>
  /** epoch seconds, may be fractional */
  now: number
}

export type PositionResult =
  | {
      ok: true
      /** Meters along the shape. */
      distance: number
      point: Ground
      /** Radians clockwise from north (-z). */
      heading: number
      /** Stop indices (into geometry.stops) of the hop; equal when the train is at a stop. */
      fromIndex: number
      toIndex: number
      /** Progress along the hop, 0..1. */
      fraction: number
      /** Seconds until the origin stop's predicted time when the train hasn't left it (not STOPPED_AT); else null. */
      departsInS: number | null
    }
  | { ok: false; reason: 'off-pattern' | 'no-arrival' }

interface Hop {
  from: number
  to: number
  /** predicted arrival at `to`; null when the train is simply at `to` */
  arriveAt: number | null
  departsInS: number | null
  fraction?: number
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1)

/** Picks the hop (previous stop → next stop) the train is on, or a fixed stop. */
function chooseHop(input: PositionInput): Hop | PositionResult {
  const { geometry, status, stopId, arrivals, now } = input
  const stops = geometry.stops
  const arrivalAt = (stop: StopId): number | undefined => arrivals.find((a) => a[0] === stop)?.[1]
  const atOrigin = (tN: number): Hop => ({ from: 0, to: 0, arriveAt: null, departsInS: tN - now, fraction: 0 })

  if (status === 'STOPPED_AT') {
    const k = stopId === null ? -1 : stops.indexOf(stopId)
    if (k < 0) return { ok: false, reason: 'off-pattern' }
    const next = stops[k + 1]
    const tN = next === undefined ? undefined : arrivalAt(next)
    if (tN === undefined) return { from: k, to: k, arriveAt: null, departsInS: null, fraction: 0 }
    return { from: k, to: k + 1, arriveAt: tN, departsInS: null }
  }

  if (status === 'IN_TRANSIT_TO' || status === 'INCOMING_AT') {
    const j = stopId === null ? -1 : stops.indexOf(stopId)
    if (j < 0) return { ok: false, reason: 'off-pattern' }
    const tN = arrivalAt(stops[j]!)
    if (tN === undefined) return { ok: false, reason: 'no-arrival' }
    return j === 0 ? atOrigin(tN) : { from: j - 1, to: j, arriveAt: tN, departsInS: null }
  }

  // No VehiclePosition: infer the next stop from the feed-ordered arrivals.
  const onPattern = arrivals.filter((a) => stops.includes(a[0]))
  if (onPattern.length === 0) return { ok: false, reason: 'off-pattern' }
  const upcoming = onPattern.find((a) => a[1] >= now)
  if (!upcoming) {
    const j = stops.indexOf(onPattern[onPattern.length - 1]![0])
    return { from: Math.max(j - 1, 0), to: j, arriveAt: null, departsInS: null, fraction: 1 }
  }
  const j = stops.indexOf(upcoming[0])
  return j === 0 ? atOrigin(upcoming[1]) : { from: j - 1, to: j, arriveAt: upcoming[1], departsInS: null }
}

/**
 * Where a train is along its shape: interpolated from the hop's scheduled run time and the
 * predicted arrival at its next stop. Overdue trains wait at the next platform, delayed or
 * dwelling ones hold at the previous stop. STOPPED_AT still interpolates toward the next stop,
 * because B-division feeds leave STOPPED_AT set after the train departs.
 */
export function positionAlongShape(input: PositionInput): PositionResult {
  const hop = chooseHop(input)
  if ('ok' in hop) return hop
  const { geometry, segments, now, status } = input
  const { stops, stopDistances: D } = geometry

  let fraction = hop.fraction
  if (fraction === undefined) {
    const run =
      segments[segmentKey(stops[hop.from]!, stops[hop.to]!)] ??
      Math.max(MIN_RUN_S, (D[hop.to]! - D[hop.from]!) / FALLBACK_SPEED_MPS)
    fraction = clamp01(1 - (hop.arriveAt! - now) / run)
    if (status === 'INCOMING_AT') fraction = Math.max(fraction, INCOMING_MIN_FRACTION)
  }
  const distance = D[hop.from]! + fraction * (D[hop.to]! - D[hop.from]!)
  const { point, heading } = pointAtDistance(geometry.line, distance)
  return {
    ok: true,
    distance,
    point,
    heading,
    fromIndex: hop.from,
    toIndex: hop.to,
    fraction,
    departsInS: hop.departsInS,
  }
}
