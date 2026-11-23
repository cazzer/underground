/**
 * A trip's legs on the drawn map (2q7.45.2). Pure: a ride leg (a route and its ordered stops) becomes the stretch
 * [d0, d1] of one drawn shape, found by projecting each stop's own station point forward along the candidates; a walk
 * leg becomes the line between its two station points. Works on `network.shapes` or the banded ones alike: both
 * draw the same ground path, but the banded one's extra vertices and cover can move a projection by up to a metre,
 * so recompute the spans on the banded paths once they arrive.
 */
import type { RouteId, ShapeId, StationId, StopId } from '../data/schema'
import type { Station, ShapePath } from './network'
import type { Ground } from './projection'
import { pointAtDistance, projectForward } from './realtime/polyline'
import type { RideLeg, WalkLeg } from './route/types'

/** Offsets closer than this tie, so float noise between banded and unbanded paths never flips a pick. */
export const OFFSET_TIE_M = 0.01

/** A stop farther than this from a shape's line does not ride it (parallel lines sit within 150 m, so the hint decides those). */
export const MAX_STOP_OFFSET_M = 150

export type SpanShape = Pick<ShapePath, 'id' | 'routeId' | 'direction' | 'primary' | 'points' | 'cumulative' | 'length'>

export interface SpanContext {
  shapes: readonly SpanShape[]
  stopStations: ReadonlyMap<StopId, Station>
  /** trip-index patterns (shape id to its stop run): tells an express from a local on the same track. */
  patterns?: Readonly<Record<ShapeId, { readonly stops: readonly StopId[] }>>
}

export interface RideShapeSpan {
  kind: 'ride'
  legIndex: number
  routeId: RouteId
  shapeId: ShapeId
  d0: number
  d1: number
  /** The largest distance from a stop to the line; the terminal clamp's overshoot shows here. */
  maxOffsetM: number
  /**
   * `pattern`: a shape of the route whose hinted pattern holds the leg's stops; `route`: geometry on the route's own
   * shapes; `pattern-other`: another route's shape whose hinted pattern holds them; `other`: another route's geometry.
   */
  matched: 'pattern' | 'route' | 'pattern-other' | 'other'
}
export interface RideStraightSpan {
  kind: 'straight'
  legIndex: number
  routeId: RouteId
  points: Ground[]
}
export type RideSpan = RideShapeSpan | RideStraightSpan
export interface WalkSpan {
  kind: 'walk'
  legIndex: number
  fromStationId: StationId
  toStationId: StationId
  /** Both stations are members of one complex, so the walk is a change inside a station as the UI shows it. */
  sameComplex: boolean
  from: Ground
  to: Ground
}
export type TripSpan = RideSpan | WalkSpan

export type SpanLeg =
  | ({ kind: 'ride' } & Pick<RideLeg, 'routeId' | 'stops'>)
  | ({ kind: 'walk' } & Pick<WalkLeg, 'fromStop' | 'toStop' | 'sameStation'>)

/** Each child stop to its station (the stop's own point, so a complex's members each use theirs). */
export function stopStations(stations: readonly Station[]): Map<StopId, Station> {
  const map = new Map<StopId, Station>()
  for (const station of stations) for (const stop of station.stops) map.set(stop, station)
  return map
}

function stationOf(ctx: SpanContext, stop: StopId): Station {
  const station = ctx.stopStations.get(stop)
  if (!station) throw new Error(`Trip leg names stop "${stop}", which no station lists`)
  return station
}

interface Fit {
  shape: SpanShape
  d0: number
  d1: number
  maxOffsetM: number
}

/** Every stop's point projected forward along the shape; null when one lies too far off or the run doesn't advance. */
function fit(shape: SpanShape, points: readonly Ground[]): Fit | null {
  let cursor = { segment: 0, t: 0 }
  let d0 = 0
  let d1 = 0
  let maxOffsetM = 0
  for (let i = 0; i < points.length; i++) {
    const hit = projectForward(shape, points[i]!, cursor)
    if (hit.offsetM > MAX_STOP_OFFSET_M) return null
    if (i === 0) d0 = hit.distance
    d1 = hit.distance
    maxOffsetM = Math.max(maxOffsetM, hit.offsetM)
    cursor = { segment: hit.segment, t: hit.t }
  }
  return d1 > d0 ? { shape, d0, d1, maxOffsetM } : null
}

/** Primary first (when `primaryFirst`: it means nothing across routes), then the smallest offset, then the shape id. */
function better(a: Fit, b: Fit, primaryFirst: boolean): boolean {
  if (primaryFirst && a.shape.primary !== b.shape.primary) return a.shape.primary
  if (Math.abs(a.maxOffsetM - b.maxOffsetM) > OFFSET_TIE_M) return a.maxOffsetM < b.maxOffsetM
  return a.shape.id < b.shape.id
}

function bestFit(shapes: readonly SpanShape[], points: readonly Ground[], primaryFirst: boolean): Fit | null {
  let best: Fit | null = null
  for (const shape of shapes) {
    const f = fit(shape, points)
    if (f && (!best || better(f, best, primaryFirst))) best = f
  }
  return best
}

/** True when `stops` is a contiguous run of `pattern`. */
function containsRun(pattern: readonly StopId[], stops: readonly StopId[]): boolean {
  for (let at = pattern.indexOf(stops[0]!); at >= 0; at = pattern.indexOf(stops[0]!, at + 1)) {
    if (stops.every((s, i) => pattern[at + i] === s)) return true
  }
  return false
}

/**
 * The shape stretch a ride leg draws on: the first tier with a fit (hinted pattern, the route's shapes, any shape of
 * the direction), else a straight line through its stop points.
 */
export function rideSpan(leg: Pick<RideLeg, 'routeId' | 'stops'>, legIndex: number, ctx: SpanContext): RideSpan {
  const first = leg.stops[0]
  if (first === undefined) throw new Error(`Ride leg ${legIndex} on ${leg.routeId} has no stops`)
  const direction = first.slice(-1)
  if (direction !== 'N' && direction !== 'S') throw new Error(`Ride leg ${legIndex}: stop "${first}" has no N or S suffix`)
  const points = leg.stops.map((s) => stationOf(ctx, s).pos)

  const { patterns } = ctx
  const sameDirection = ctx.shapes.filter((s) => s.direction === direction)
  const ofRoute = sameDirection.filter((s) => s.routeId === leg.routeId)
  const holdsRun = (s: SpanShape): boolean => patterns?.[s.id] !== undefined && containsRun(patterns[s.id]!.stops, leg.stops)
  const tiers: [RideShapeSpan['matched'], SpanShape[], boolean][] = [
    ['pattern', ofRoute.filter(holdsRun), true],
    ['route', ofRoute, true],
    ['pattern-other', sameDirection.filter(holdsRun), false],
    ['other', sameDirection, false],
  ]
  for (const [matched, candidates, primaryFirst] of tiers) {
    const f = bestFit(candidates, points, primaryFirst)
    if (f) return { kind: 'ride', legIndex, routeId: leg.routeId, shapeId: f.shape.id, d0: f.d0, d1: f.d1, maxOffsetM: f.maxOffsetM, matched }
  }
  return { kind: 'straight', legIndex, routeId: leg.routeId, points: points.map((p) => ({ x: p.x, z: p.z })) }
}

/** A change inside one station draws nothing; a transfer between stations is the line between their points. */
export function walkSpan(leg: Pick<WalkLeg, 'fromStop' | 'toStop' | 'sameStation'>, legIndex: number, ctx: SpanContext): WalkSpan | null {
  if (leg.sameStation) return null
  const from = stationOf(ctx, leg.fromStop)
  const to = stationOf(ctx, leg.toStop)
  return {
    kind: 'walk',
    legIndex,
    fromStationId: from.id,
    toStationId: to.id,
    sameComplex: from.leadId === to.leadId,
    from: { x: from.pos.x, z: from.pos.z },
    to: { x: to.pos.x, z: to.pos.z },
  }
}

/** The legs' spans in leg order; a leg that draws nothing is left out (`legIndex` still names its place). */
export function journeySpans(legs: readonly SpanLeg[], ctx: SpanContext): TripSpan[] {
  const spans: TripSpan[] = []
  legs.forEach((leg, i) => {
    const span = leg.kind === 'ride' ? rideSpan(leg, i, ctx) : walkSpan(leg, i, ctx)
    if (span) spans.push(span)
  })
  return spans
}

/** Ground points from `d0` to `d1` along the path: both ends interpolated, the vertices strictly between. Heights are the caller's. */
export function spanPoints(path: SpanShape, d0: number, d1: number): Ground[] {
  const out = [pointAtDistance(path, d0).point]
  if (d1 <= d0) return out
  for (let i = 0; i < path.points.length; i++) {
    const d = path.cumulative[i]!
    if (d > d0 && d < d1) out.push({ x: path.points[i]!.x, z: path.points[i]!.z })
  }
  out.push(pointAtDistance(path, d1).point)
  return out
}
