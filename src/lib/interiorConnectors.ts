/**
 * Stairs, ramps, walkways, escalators and elevators as segments in the interior's strong and fine layers.
 * `.ts` import paths: scripts/lib/stationOutputs.test.ts (nodenext) loads this file.
 */
import type { Connector, LocalPoint } from '../data/stationSchema.ts'
import { lerp, lerpRgb, type InteriorRole, type Rgb, type SegmentSink, type Vec3 } from './interiorSegments.ts'

export interface ConnectorContext {
  strong: SegmentSink
  fine: SegmentSink
  /** Real (unscaled) walking-surface y of the level at an index. */
  realY: (levelIndex: number) => number
  /** Index of the street level: 0 below ground, the last (lowest) level at an elevated station. */
  streetIndex: number
  /** Vertical exaggeration; x/z are never scaled. */
  yScale: number
  /** Real rise per drawn stair step, meters. */
  stepRise: number
  colorOf: (role: InteriorRole, levelIndex: number) => Rgb
  /** Unit plan direction along the platforms: zero-run escalators run along it, elevator shafts square to it. */
  axis: LocalPoint
  /** Plan center of the interior: elevator doors face it, zero-run escalators descend toward it. */
  center: LocalPoint
  /** Whether the elevator or escalator with this id is out of service: drawn in the `outage` role, with an X. */
  outOfService: (connectorId: string) => boolean
  /** Where a zero-run escalator's run sits (`spreadBanks`); undefined for every other connector. */
  anchorOf: (connectorId: string) => RunAnchor | undefined
}

/**
 * Where an escalator with no plan run of its own is laid. `point` is shared by its whole bank;
 * `lateral` (meters) moves it across the station axis along the axis's fixed clockwise normal in plan
 * (south for an east axis), whichever way the run descends. A bank's id order runs along that normal.
 */
export interface RunAnchor {
  point: LocalPoint
  /** The run's street end (the upper one below ground, the lower one at an elevated station) sits on `point`;
   *  otherwise the run is centered on it. */
  atEntrance: boolean
  lateral: number
}

/** Below this plan run (meters) a connector has no direction to draw along. */
export const MIN_RUN = 0.01
/** Plan run per meter of rise for an escalator with no run of its own: a 30 degree incline. */
const ESCALATOR_RUN_PER_RISE = Math.sqrt(3)
/** Handrails: lateral position as a fraction of the half-width, and real (unexaggerated) height above the steps. */
const RAIL_SIDE = 0.6
const RAIL_HEIGHT_M = 0.9
/**
 * Travel chevrons, a zoom-in detail: one per this many meters of run, each this deep (at most
 * `CHEVRON_MAX_DEPTH` of the run), arms at this fraction of the half-width.
 */
const CHEVRON_SPACING_M = 4.5
const CHEVRON_DEPTH_M = 1.5
const CHEVRON_MAX_DEPTH = 0.4
const CHEVRON_SIDE = 1
/** An out-of-service escalator's cross: a square this many meters on a side (at least; as wide as the band when wider), so it reads at the landing zoom. */
const OUTAGE_CROSS_M = 3
/** At most this fraction of the run either side of mid-run. */
const OUTAGE_CROSS_MAX_HALF = 0.4
/** Elevator door gap and cab inset, as fractions of the shaft width. */
const DOOR_GAP = 0.45
const CAB_INSET = 0.25

/**
 * Plan ends of an inclined connector. An escalator from the equipment inventory has one point for
 * both ends; it gets a 30 degree run along `axis`, placed by `anchor` (by default centered on its
 * own point). Pinned at its entrance, the street end sits there and the run heads toward `center`:
 * down from the street below ground (`streetEnd` 'upper'), up from it at an elevated station
 * ('lower'). Centered, it descends toward `center`. Any other connector without a run is a data error.
 */
export function inclineEnds(
  c: Connector,
  riseM: number,
  axis: LocalPoint,
  center: LocalPoint,
  anchor?: RunAnchor,
  streetEnd: 'lower' | 'upper' = 'upper',
): { lower: LocalPoint; upper: LocalPoint } {
  const run = Math.hypot(c.upper.x - c.lower.x, c.upper.z - c.lower.z)
  if (run >= MIN_RUN) return { lower: [c.lower.x, c.lower.z], upper: [c.upper.x, c.upper.z] }
  if (c.kind !== 'escalator') throw new Error(`Connector "${c.id}" has no horizontal run`)
  const length = riseM * ESCALATOR_RUN_PER_RISE
  const { point: ref, atEntrance, lateral } = anchor ?? { point: [c.lower.x, c.lower.z], atEntrance: false, lateral: 0 }
  // +1 when the reference point lies along +axis from the center: the lower end then goes toward -axis.
  // Taken from the shared point, so every escalator of a bank runs the same way.
  const s = (ref[0] - center[0]) * axis[0] + (ref[1] - center[1]) * axis[1] < 0 ? -1 : 1
  const at = (t: number): LocalPoint => [
    ref[0] + s * axis[0] * t - axis[1] * lateral,
    ref[1] + s * axis[1] * t + axis[0] * lateral,
  ]
  if (!atEntrance) return { lower: at(-length / 2), upper: at(length / 2) }
  return streetEnd === 'upper' ? { lower: at(-length), upper: at(0) } : { lower: at(0), upper: at(-length) }
}

interface Incline {
  /** Point at fraction t of the run, `side` half-widths to the right of travel (-1..1), `lift` meters up (as drawn). */
  at: (t: number, side: number, lift?: number) => Vec3
  /** Plan run, meters. */
  run: number
  /** Role color at fraction t of the run. */
  color: (role: InteriorRole, t: number) => Rgb
}

function incline(ctx: ConnectorContext, c: Connector, li: number, ui: number): Incline {
  const rise = ctx.realY(ui) - ctx.realY(li)
  const { lower, upper } = inclineEnds(c, rise, ctx.axis, ctx.center, ctx.anchorOf(c.id), li === ctx.streetIndex ? 'lower' : 'upper')
  const dx = upper[0] - lower[0]
  const dz = upper[1] - lower[1]
  const run = Math.hypot(dx, dz)
  const px = (-dz / run) * (c.width / 2)
  const pz = (dx / run) * (c.width / 2)
  const yL = ctx.realY(li) * ctx.yScale
  const yU = ctx.realY(ui) * ctx.yScale
  return {
    at: (t, side, lift = 0) => [lerp(lower[0], upper[0], t) + side * px, lerp(yL, yU, t) + lift, lerp(lower[1], upper[1], t) + side * pz],
    run,
    color: (role, t) => lerpRgb(ctx.colorOf(role, li), ctx.colorOf(role, ui), t),
  }
}

/** The four strong edges of an incline: both sides, then the lower and upper ends. */
function band(ctx: ConnectorContext, g: Incline, role: InteriorRole): void {
  const [c0, c1] = [g.color(role, 0), g.color(role, 1)]
  ctx.strong.segment(g.at(0, 1), g.at(1, 1), c0, c1)
  ctx.strong.segment(g.at(0, -1), g.at(1, -1), c0, c1)
  ctx.strong.segment(g.at(0, -1), g.at(0, 1), c0)
  ctx.strong.segment(g.at(1, -1), g.at(1, 1), c1)
}

/** Stairs and ramps: the band, plus one fine hatch per step for stairs. */
export function drawRamp(ctx: ConnectorContext, c: Connector, li: number, ui: number): void {
  const g = incline(ctx, c, li, ui)
  band(ctx, g, 'stair')
  if (c.kind === 'ramp') return
  const n = Math.max(1, Math.round((ctx.realY(ui) - ctx.realY(li)) / ctx.stepRise))
  for (let i = 1; i < n; i++) ctx.fine.segment(g.at(i / n, -1), g.at(i / n, 1), g.color('step', i / n))
}

/**
 * Walkways: a flat connector between two areas of one level (two mezzanines of a complex), drawn as the two strong
 * side edges only, in the outline color: no end caps, since it opens onto both areas. `dashed` on an estimated layout
 * or between two approximate slabs (the caller decides). Needs a plan run (a data error, thrown by `inclineEnds`, without one).
 */
export function drawWalkway(ctx: ConnectorContext, c: Connector, li: number, dashed: boolean): void {
  const g = incline(ctx, c, li, li)
  const [c0, c1] = [g.color('outline', 0), g.color('outline', 1)]
  ctx.strong.segment(g.at(0, 1), g.at(1, 1), c0, c1, dashed)
  ctx.strong.segment(g.at(0, -1), g.at(1, -1), c0, c1, dashed)
}

/** A two-stroke chevron with its apex at `apex` (fraction of the run), opening back by `depth`. */
function chevron(ctx: ConnectorContext, g: Incline, apex: number, depth: number): void {
  const tip = g.at(apex, 0)
  const cTip = g.color('escalator', apex)
  const back = apex - depth
  const cBack = g.color('escalator', back)
  ctx.strong.segment(g.at(back, -CHEVRON_SIDE), tip, cBack, cTip)
  ctx.strong.segment(g.at(back, CHEVRON_SIDE), tip, cBack, cTip)
}

/**
 * An out-of-service escalator's mark: two strong strokes corner to corner of a fixed-size square (OUTAGE_CROSS_M,
 * or the band's width if wider) centered on the band at mid-run.
 */
function outageCross(ctx: ConnectorContext, c: Connector, g: Incline): void {
  const size = Math.max(OUTAGE_CROSS_M, c.width)
  const half = Math.min(size / 2 / g.run, OUTAGE_CROSS_MAX_HALF)
  const side = size / c.width
  const color = g.color('outage', 0.5)
  ctx.strong.segment(g.at(0.5 - half, -side), g.at(0.5 + half, side), color)
  ctx.strong.segment(g.at(0.5 - half, side), g.at(0.5 + half, -side), color)
}

/**
 * Escalators: the band, handrails and, when the travel direction is known, travel chevrons. One that is out of
 * service is drawn in the `outage` role with a cross over the band, and no chevrons (it isn't moving).
 */
export function drawEscalator(ctx: ConnectorContext, c: Connector, li: number, ui: number): void {
  const g = incline(ctx, c, li, ui)
  const out = ctx.outOfService(c.id)
  const role: InteriorRole = out ? 'outage' : 'escalator'
  band(ctx, g, role)
  const [c0, c1] = [g.color(role, 0), g.color(role, 1)]
  for (const side of [-RAIL_SIDE, RAIL_SIDE]) ctx.fine.segment(g.at(0, side, RAIL_HEIGHT_M), g.at(1, side, RAIL_HEIGHT_M), c0, c1)
  if (out) return outageCross(ctx, c, g)
  if (!c.travel) return
  // A fraction of the run, signed so that a chevron opens back from the travel direction.
  const depth = (c.travel === 'down' ? -1 : 1) * Math.min(CHEVRON_DEPTH_M / g.run, CHEVRON_MAX_DEPTH)
  const n = Math.max(1, Math.floor(g.run / CHEVRON_SPACING_M))
  for (let k = 0; k < n; k++) chevron(ctx, g, (k + 0.5) / n + depth / 2, depth)
}

/** Shaft square around the elevator's point, sides along `axis` and across it, shrunk by `inset`. */
function shaftCorners(c: Connector, axis: LocalPoint, inset = 0): LocalPoint[] {
  const h = c.width / 2 - inset
  const [ux, uz] = axis
  const [vx, vz] = [-uz, ux]
  const { x, z } = c.lower
  const corner = (a: number, b: number): LocalPoint => [x + h * (a * ux + b * vx), z + h * (a * uz + b * vz)]
  return [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]
}

const elevatorRole = (ctx: ConnectorContext, c: Connector): InteriorRole => (ctx.outOfService(c.id) ? 'outage' : 'elevator')

/** Elevator shaft from its lower to its upper level: four strong corner verticals. */
export function drawElevatorShaft(ctx: ConnectorContext, c: Connector, li: number, ui: number): void {
  const yL = ctx.realY(li) * ctx.yScale
  const yU = ctx.realY(ui) * ctx.yScale
  const role = elevatorRole(ctx, c)
  const cL = ctx.colorOf(role, li)
  const cU = ctx.colorOf(role, ui)
  for (const [x, z] of shaftCorners(c, ctx.axis)) ctx.strong.segment([x, yL, z], [x, yU, z], cL, cU)
}

/**
 * Index of the shaft side facing the interior's plan center, in `shaftCorners` order (0 is -across,
 * 1 +axis, 2 +across, 3 -axis; north, east, south, west for an east axis). When the shaft sits on
 * the center, the side facing south (toward the camera).
 */
export function doorSide(c: Connector, center: LocalPoint, axis: LocalPoint): number {
  const [ux, uz] = axis
  const [vx, vz] = [-uz, ux]
  const dx = center[0] - c.lower.x
  const dz = center[1] - c.lower.z
  if (Math.abs(dx) < MIN_RUN && Math.abs(dz) < MIN_RUN) {
    const south = [-vz, uz, vz, -uz]
    return south.indexOf(Math.max(...south))
  }
  const du = dx * ux + dz * uz
  const dv = dx * vx + dz * vz
  if (Math.abs(du) > Math.abs(dv)) return du > 0 ? 1 : 3
  return dv > 0 ? 2 : 0
}

/** One served level of an elevator: a doored square and its cab. */
export function drawElevatorStop(ctx: ConnectorContext, c: Connector, levelIndex: number): void {
  const y = ctx.realY(levelIndex) * ctx.yScale
  const color = ctx.colorOf(elevatorRole(ctx, c), levelIndex)
  const corners = shaftCorners(c, ctx.axis)
  const door = doorSide(c, ctx.center, ctx.axis)
  const edge = (1 - DOOR_GAP) / 2
  for (let i = 0; i < 4; i++) {
    const p = corners[i]!
    const q = corners[(i + 1) % 4]!
    const point = (t: number): Vec3 => [lerp(p[0], q[0], t), y, lerp(p[1], q[1], t)]
    if (i !== door) {
      ctx.strong.segment(point(0), point(1), color)
      continue
    }
    ctx.strong.segment(point(0), point(edge), color)
    ctx.strong.segment(point(1 - edge), point(1), color)
  }
  ctx.fine.loop(shaftCorners(c, ctx.axis, CAB_INSET * c.width), y, color)
  // Out of service: the whole shaft square is crossed out, in strong strokes, so it reads from far out.
  if (!ctx.outOfService(c.id)) return
  for (const [a, b] of [[0, 2], [1, 3]] as const) ctx.strong.segment([corners[a]![0], y, corners[a]![1]], [corners[b]![0], y, corners[b]![1]], color)
}
