/**
 * Stairs, ramps, escalators and elevators as segments in the interior's strong and fine layers.
 * `.ts` import paths: scripts/lib/interiorRegistry.test.ts (nodenext) loads this file.
 * TEMPORARY: the unchosen `MachineStyle` branches go once the 9wc.8 look card is decided (see machineLook.ts).
 */
import type { Connector, LocalPoint, StationInterior } from '../data/stationSchema.ts'
import { lerp, lerpRgb, type InteriorRole, type Rgb, type SegmentWriter, type Vec3 } from './interiorSegments.ts'

/** A: rails and cab; B: plain band and box; C: plan symbols (centerline arrow, crossed square). */
export interface MachineStyle {
  escalator: 'rails' | 'band' | 'arrow'
  elevator: 'cab' | 'box' | 'cross'
}

export interface ConnectorContext {
  strong: SegmentWriter
  fine: SegmentWriter
  /** Real (unscaled) walking-surface y of the level at an index. */
  realY: (levelIndex: number) => number
  /** Vertical exaggeration; x/z are never scaled. */
  yScale: number
  /** Real rise per drawn stair step, meters. */
  stepRise: number
  colorOf: (role: InteriorRole, levelIndex: number) => Rgb
  /** Unit plan direction along the platforms: zero-run escalators are laid along it. */
  axis: LocalPoint
  /** Plan center of the interior: elevator doors face it. */
  center: LocalPoint
  machines: MachineStyle
}

/** Below this plan run (meters) a connector has no direction to draw along. */
const MIN_RUN = 0.01
/** Plan run per meter of rise for an escalator with no run of its own: a 30 degree incline. */
const ESCALATOR_RUN_PER_RISE = Math.sqrt(3)
/** Handrails: lateral position as a fraction of the half-width, and real height above the steps. */
const RAIL_SIDE = 0.6
const RAIL_HEIGHT_M = 0.9
/** Travel chevrons: one per this many meters of run, each this deep, arms at this fraction of the half-width. */
const CHEVRON_SPACING_M = 3
const CHEVRON_DEPTH_M = 0.8
const CHEVRON_SIDE = 0.7
/** Elevator door gap and cab inset, as fractions of the shaft width. */
const DOOR_GAP = 0.45
const CAB_INSET = 0.25

/** Longest edge of the longest platform outline as a unit vector pointing east (or south), else +x. */
export function stationAxis(interior: StationInterior): LocalPoint {
  let best: readonly LocalPoint[] | null = null
  let bestPerimeter = 0
  for (const p of interior.platforms) {
    const perimeter = p.outline.reduce((sum, a, i) => {
      const b = p.outline[(i + 1) % p.outline.length]!
      return sum + Math.hypot(b[0] - a[0], b[1] - a[1])
    }, 0)
    if (perimeter > bestPerimeter) [best, bestPerimeter] = [p.outline, perimeter]
  }
  if (!best) return [1, 0]
  let axis: LocalPoint = [1, 0]
  let longest = 0
  for (let i = 0; i < best.length; i++) {
    const a = best[i]!
    const b = best[(i + 1) % best.length]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len > longest) [axis, longest] = [[(b[0] - a[0]) / len, (b[1] - a[1]) / len], len]
  }
  return axis[0] < 0 || (axis[0] === 0 && axis[1] < 0) ? [-axis[0], -axis[1]] : axis
}

/**
 * Plan ends of an inclined connector. An escalator from the equipment inventory has one point for
 * both ends; it gets a 30 degree run centered on that point along `axis`. Any other connector
 * without a run is a data error.
 */
export function inclineEnds(c: Connector, riseM: number, axis: LocalPoint): { lower: LocalPoint; upper: LocalPoint } {
  const run = Math.hypot(c.upper.x - c.lower.x, c.upper.z - c.lower.z)
  if (run >= MIN_RUN) return { lower: [c.lower.x, c.lower.z], upper: [c.upper.x, c.upper.z] }
  if (c.kind !== 'escalator') throw new Error(`Connector "${c.id}" has no horizontal run`)
  const half = (riseM * ESCALATOR_RUN_PER_RISE) / 2
  const x = (c.lower.x + c.upper.x) / 2
  const z = (c.lower.z + c.upper.z) / 2
  return { lower: [x - axis[0] * half, z - axis[1] * half], upper: [x + axis[0] * half, z + axis[1] * half] }
}

interface Incline {
  /** Point at fraction t of the run, `side` half-widths to the left (-1..1), `lift` scaled meters up. */
  at: (t: number, side: number, lift?: number) => Vec3
  /** Plan run, meters. */
  run: number
  /** Role color at fraction t of the run. */
  color: (role: InteriorRole, t: number) => Rgb
}

function incline(ctx: ConnectorContext, c: Connector, li: number, ui: number): Incline {
  const { lower, upper } = inclineEnds(c, ctx.realY(ui) - ctx.realY(li), ctx.axis)
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

/** A two-stroke chevron with its apex at `apex` (fraction of the run), opening back by `depth`. */
function chevron(ctx: ConnectorContext, g: Incline, apex: number, depth: number): void {
  const tip = g.at(apex, 0)
  const cTip = g.color('escalator', apex)
  const back = apex - depth
  const cBack = g.color('escalator', back)
  ctx.strong.segment(g.at(back, -CHEVRON_SIDE), tip, cBack, cTip)
  ctx.strong.segment(g.at(back, CHEVRON_SIDE), tip, cBack, cTip)
}

/** Escalators: the band, plus rails (A), travel chevrons (A, B) or a centerline arrow (C). */
export function drawEscalator(ctx: ConnectorContext, c: Connector, li: number, ui: number): void {
  const g = incline(ctx, c, li, ui)
  const style = ctx.machines.escalator
  band(ctx, g, 'escalator')
  // Signed so that a chevron opens back from the travel direction.
  const dir = c.travel === 'down' ? -1 : 1
  const depth = (dir * CHEVRON_DEPTH_M) / g.run
  if (style === 'arrow') {
    ctx.strong.segment(g.at(0, 0), g.at(1, 0), g.color('escalator', 0), g.color('escalator', 1))
    if (c.travel) chevron(ctx, g, dir > 0 ? 1 : 0, depth)
    return
  }
  if (style === 'rails') {
    const lift = RAIL_HEIGHT_M * ctx.yScale
    const [c0, c1] = [g.color('escalator', 0), g.color('escalator', 1)]
    for (const side of [-RAIL_SIDE, RAIL_SIDE]) {
      ctx.fine.segment(g.at(0, side, lift), g.at(1, side, lift), c0, c1)
      ctx.fine.segment(g.at(0, side), g.at(0, side, lift), c0)
      ctx.fine.segment(g.at(1, side), g.at(1, side, lift), c1)
    }
  }
  if (!c.travel) return
  const n = Math.max(1, Math.floor(g.run / CHEVRON_SPACING_M))
  for (let k = 0; k < n; k++) chevron(ctx, g, (k + 0.5) / n + depth / 2, depth)
}

function shaftCorners(c: Connector, inset = 0): LocalPoint[] {
  const h = c.width / 2 - inset
  const { x, z } = c.lower
  return [
    [x - h, z - h],
    [x + h, z - h],
    [x + h, z + h],
    [x - h, z + h],
  ]
}

/** Elevator shaft from its lower to its upper level: four strong corner verticals (A, B) or one fine center line (C). */
export function drawElevatorShaft(ctx: ConnectorContext, c: Connector, li: number, ui: number): void {
  const yL = ctx.realY(li) * ctx.yScale
  const yU = ctx.realY(ui) * ctx.yScale
  const cL = ctx.colorOf('elevator', li)
  const cU = ctx.colorOf('elevator', ui)
  if (ctx.machines.elevator === 'cross') {
    ctx.fine.segment([c.lower.x, yL, c.lower.z], [c.lower.x, yU, c.lower.z], cL, cU)
    return
  }
  for (const [x, z] of shaftCorners(c)) ctx.strong.segment([x, yL, z], [x, yU, z], cL, cU)
}

/**
 * Index of the shaft side (0 north, 1 east, 2 south, 3 west, as in `shaftCorners`) facing the
 * interior's plan center; south (toward the camera) when the shaft sits on it.
 */
export function doorSide(c: Connector, center: LocalPoint): number {
  const dx = center[0] - c.lower.x
  const dz = center[1] - c.lower.z
  if (Math.abs(dx) < MIN_RUN && Math.abs(dz) < MIN_RUN) return 2
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 1 : 3
  return dz > 0 ? 2 : 0
}

/** One served level of an elevator: a doored square and its cab (A), a square (B) or a crossed square (C). */
export function drawElevatorStop(ctx: ConnectorContext, c: Connector, levelIndex: number): void {
  const y = ctx.realY(levelIndex) * ctx.yScale
  const color = ctx.colorOf('elevator', levelIndex)
  const corners = shaftCorners(c)
  const style = ctx.machines.elevator
  if (style !== 'cab') {
    ctx.strong.loop(corners, y, color)
    if (style === 'cross') {
      const [a, b, d, e] = corners as [LocalPoint, LocalPoint, LocalPoint, LocalPoint]
      ctx.strong.segment([a[0], y, a[1]], [d[0], y, d[1]], color)
      ctx.strong.segment([b[0], y, b[1]], [e[0], y, e[1]], color)
    }
    return
  }
  const door = doorSide(c, ctx.center)
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
  ctx.fine.loop(shaftCorners(c, CAB_INSET * c.width), y, color)
}
