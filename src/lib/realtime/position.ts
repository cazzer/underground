import { segmentKey } from '../../data/codec'
import type { Arrival, VehicleStatus } from '../../data/realtime'
import type { StopId } from '../../data/schema'
import type { Ground } from '../projection'
import { pointAtDistance } from './polyline'
import { hopArrivalShift } from './arrivalShift'
import { easeRun, rampShareFor } from './runEase'
import type { ShapeGeometry } from './shapeGeometry'
import { capArrival, type StopVisit } from './stopVisit'

/** Run time guess (m/s) for a stop pair missing from segments.json. */
export const FALLBACK_SPEED_MPS = 8
/** Floor on the fallback run time, so very short hops don't teleport. */
export const MIN_RUN_S = 30
/** INCOMING_AT means "about to arrive": never show it less than this far along the hop. */
export const INCOMING_MIN_FRACTION = 0.75
/** Nominal station dwell (s). NYCT segment run times are arrival-to-arrival, so they include it. */
export const DWELL_S = 30
/** A short hop never spends more than this share of its run time dwelling. */
export const DWELL_MAX_SHARE = 0.35

/** Seconds of a `runS` hop spent held at the origin stop before the train moves. */
export const dwellFor = (runS: number): number => Math.min(DWELL_S, DWELL_MAX_SHARE * runS)

export interface PositionInput {
  geometry: ShapeGeometry
  status: VehicleStatus | null
  stopId: StopId | null
  arrivals: readonly Arrival[]
  segments: Readonly<Record<string, number>>
  /** epoch seconds, may be fractional */
  now: number
  /** The last stop the train was seen at (see stopVisit.ts); caps a late prediction for the hop leaving it. */
  visit?: StopVisit | null
  /** The trip's own first stop, where it lays over; defaults to the shape's first stop. */
  origin?: StopId | null
  /** Seconds to pull the hop's arrival in (arrivalShift.ts; default 0). The dwell grows by the same, so the leave time stays. */
  arrivalShiftS?: number
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

/**
 * The part of a position that doesn't change between frames: which hop, its run time and its
 * arrival. Built once per poll by `planHop`; `hopDistance` then evaluates it per frame without allocating.
 */
export interface HopPlan {
  /** Stop indices (into geometry.stops) of the hop; equal when the train is at a stop. */
  from: number
  to: number
  /** Predicted arrival at `to`; null when the fraction is fixed. */
  arriveAt: number | null
  /** Scheduled seconds for the hop, arrival to arrival. */
  runS: number
  /** Seconds held at `from` before running; part of `runS`. `dwellFor(runS)` plus the arrival shift taken. */
  dwellS: number
  /** Progress along the hop when it doesn't depend on time (dwelling, overdue at the next stop); else null. */
  fixedFraction: number | null
  /** Floor on the progress (INCOMING_AT trains are never shown early in the hop); an eased run covers the rest. */
  minFraction: number
  /** Seconds until the origin stop's predicted time when the train hasn't left it (not STOPPED_AT); else null. */
  departsInS: number | null
  /** `arriveAt` comes from the visit to the last stop (stopVisit.ts), not the feed's prediction; counted in `?debug`. */
  capped: boolean
  /** The eased run's ramp share (`rampShareFor`): 0.2, less on a hop fast enough to cruise above 25 m/s. */
  rampShare: number
}

export interface PlanFailure {
  ok: false
  reason: 'off-pattern' | 'no-arrival'
}

const clamp01 = (v: number): number => Math.min(Math.max(v, 0), 1)

/** Picks the hop (previous stop → next stop) the train is on, or a fixed stop. */
function chooseHop(input: PositionInput): Hop | PlanFailure {
  const { geometry, status, stopId, arrivals, now } = input
  const stops = geometry.stops
  // Linear scans per call are fine at ~340 trips and one call per poll.
  const arrivalAt = (stop: StopId): number | undefined => arrivals.find((a) => a[0] === stop)?.[1]
  const atOrigin = (tN: number): Hop => ({ from: 0, to: 0, arriveAt: null, departsInS: tN - now, fraction: 0 })

  // The next stop after `after` with a prediction, from the feed-ordered arrivals; null when there is none.
  // `anchored`: the train is known to be at `after`, so a hop that skips stops starts there.
  const fromArrivals = (after: number, anchored = false): Hop | null => {
    const onPattern = arrivals.filter((a) => stops.indexOf(a[0]) > after)
    if (onPattern.length === 0) return null
    const upcoming = onPattern.find((a) => a[1] >= now)
    if (!upcoming) {
      const j = stops.indexOf(onPattern[onPattern.length - 1]![0])
      return { from: Math.max(j - 1, 0), to: j, arriveAt: null, departsInS: null, fraction: 1 }
    }
    const j = stops.indexOf(upcoming[0])
    if (j === 0) return atOrigin(upcoming[1])
    return { from: anchored && j > after + 1 ? after : j - 1, to: j, arriveAt: upcoming[1], departsInS: null }
  }

  if (status === 'STOPPED_AT') {
    const k = stopId === null ? -1 : stops.indexOf(stopId)
    if (k < 0) return { ok: false, reason: 'off-pattern' }
    const next = stops[k + 1]
    const tN = next === undefined ? undefined : arrivalAt(next)
    if (tN !== undefined) return { from: k, to: k + 1, arriveAt: tN, departsInS: null }
    // Hold only at the terminal. With a next stop but no prediction for it (an express on a local pattern,
    // or a VehiclePosition that lags the train), the arrivals say where the train has got to, and it runs from here.
    return (next !== undefined && fromArrivals(k, true)) || { from: k, to: k, arriveAt: null, departsInS: null, fraction: 0 }
  }

  if (status === 'IN_TRANSIT_TO' || status === 'INCOMING_AT') {
    const j = stopId === null ? -1 : stops.indexOf(stopId)
    if (j < 0) return { ok: false, reason: 'off-pattern' }
    const tN = arrivalAt(stops[j]!)
    if (tN === undefined) return { ok: false, reason: 'no-arrival' }
    return j === 0 ? atOrigin(tN) : { from: j - 1, to: j, arriveAt: tN, departsInS: null }
  }

  // No VehiclePosition: infer the next stop from the feed-ordered arrivals.
  return fromArrivals(-1) ?? { ok: false, reason: 'off-pattern' }
}

/**
 * Chooses the hop and looks up its run time. Pass `input.now` as the time of the poll: the hop is
 * frozen between polls, so a trip with no VehiclePosition does not advance to its next hop until
 * the next poll (it waits at its next stop for at most one poll interval).
 */
export function planHop(input: PositionInput): HopPlan | PlanFailure {
  const hop = chooseHop(input)
  if ('ok' in hop) return hop
  const { geometry, segments, status } = input
  const { stops, stopDistances: D } = geometry
  const runS =
    segments[segmentKey(stops[hop.from]!, stops[hop.to]!)] ??
    Math.max(MIN_RUN_S, (D[hop.to]! - D[hop.from]!) / FALLBACK_SPEED_MPS)
  const dwell0 = dwellFor(runS)
  // Never capped leaving the trip's own origin: a train laying over there has no schedule to keep. It may still
  // be held there (the floor), and a short turn joined to a longer pattern starts mid-shape, hence `origin`.
  const fromOrigin = stops[hop.from] === (input.origin ?? stops[0])
  const moves = hop.arriveAt !== null && hop.from !== hop.to
  const cappedAt = moves && input.visit ? capArrival(hop.arriveAt!, stops[hop.from]!, runS, dwell0, input.visit, !fromOrigin) : hop.arriveAt
  // The arrival is shown sooner (arrivalShift.ts) and the dwell grows by as much, so the train leaves when it would
  // have. A train the poll still places at the platform is held there: its departure is the unknown part. On the
  // lingering-STOPPED_AT feeds (stopVisit.ts) `here` can flap between polls; the shift then disengages and
  // smoothing holds the dot, rather than the plan moving it back.
  const held = input.visit?.here === true && input.visit.stopId === stops[hop.from]
  const shiftS =
    cappedAt === null || !moves || held ? 0 : hopArrivalShift(input.arrivalShiftS ?? 0, runS - dwell0, D[hop.to]! - D[hop.from]!)
  const dwellS = dwell0 + shiftS
  const arriveAt = cappedAt === null ? null : cappedAt - shiftS
  return {
    from: hop.from,
    to: hop.to,
    arriveAt,
    runS,
    dwellS,
    fixedFraction: hop.fraction ?? null,
    minFraction: hop.fraction === undefined && status === 'INCOMING_AT' ? INCOMING_MIN_FRACTION : 0,
    departsInS: hop.departsInS,
    capped: cappedAt !== hop.arriveAt,
    rampShare: rampShareFor(D[hop.to]! - D[hop.from]!, runS - dwellS),
  }
}

/** Progress along the planned hop at `now`, 0..1. Pure arithmetic: runs per frame. */
export function hopFraction(plan: HopPlan, now: number): number {
  if (plan.fixedFraction !== null) return plan.fixedFraction
  // The train holds at `from` until `runS - dwellS` before arriving, then runs for the rest of the hop.
  const u = clamp01(1 - (plan.arriveAt! - now) / (plan.runS - plan.dwellS))
  // An INCOMING_AT floor eases over the rest of the hop, so the floored train still pulls away and brakes. It is
  // never behind the plain ease (a status flip only moves the target forward) and still arrives at u = 1.
  const m = plan.minFraction
  return m + (1 - m) * easeRun(u, plan.rampShare)
}

/** Meters along the shape at `now`. No allocation: runs per frame. */
export function hopDistance(plan: HopPlan, geometry: ShapeGeometry, now: number): number {
  const D = geometry.stopDistances
  return D[plan.from]! + hopFraction(plan, now) * (D[plan.to]! - D[plan.from]!)
}

/**
 * Where a train is along its shape: interpolated from the hop's scheduled run time and the
 * predicted arrival at its next stop, less `input.arrivalShiftS` (the dwell grows by as much, so the train still
 * leaves on time). The first `dwellFor(runS)` seconds of the hop, plus those, are a dwell
 * at the origin stop (segment times include it), so the train holds there, then runs and still
 * arrives on that arrival; the same rule for every status, so a status flip never moves
 * the target. The run pulls away, cruises and brakes (`easeRun`: a trapezoid, 1.25x the average speed at
 * cruise, capped at 25 m/s by shorter ramps). The shorter, eased run means a mid-hop revision of the predicted arrival moves the target up to
 * 1.25/0.65 (about 1.9x) as far as a constant-speed run over the whole hop would; the correction layer absorbs it. Overdue trains wait at
 * the next platform, delayed or dwelling ones hold at the previous stop. STOPPED_AT still interpolates toward the next stop,
 * because B-division feeds leave STOPPED_AT set after the train departs.
 */
export function positionAlongShape(input: PositionInput): PositionResult {
  const plan = planHop(input)
  if ('ok' in plan) return plan
  const { geometry, now } = input
  const distance = hopDistance(plan, geometry, now)
  const { point, heading } = pointAtDistance(geometry.line, distance)
  return {
    ok: true,
    distance,
    point,
    heading,
    fromIndex: plan.from,
    toIndex: plan.to,
    fraction: hopFraction(plan, now),
    departsInS: plan.departsInS,
  }
}
