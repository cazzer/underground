/**
 * Pure framing of 3D points in the free area: the smallest camera distance from the landing distance up to
 * FRAME_MAX_DISTANCE that keeps the required points and as many of the wanted ones as fit inside the padded free rect,
 * the target panned off the centred one only as far as needed. Each point's height is drawn at the depth factor of the
 * distance tried (as the interior's group scales it). The target stays within TARGET_RADIUS_M of one of the anchors
 * (the stations the frame is for: a short drag can't move focus past ENTER_RADIUS 140) and within `centerRadius` of the
 * centred target. A bare station (bareStationFrame) frames its point and its entrance marks; an interior with a trip's
 * way out frames that path (pathFrame.ts).
 */
import { clipToHalfPlane, nearestInPolygon, polygonHalfPlanes, square, type HalfPlane } from './convexRegion'
import { createFollowView, followTargetInto, writeFollowView, type FollowView } from './follow'
import type { Viewport } from './framing'
import { LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import { PAN_RADIUS_BARE } from './orbitLimits'
import type { Ground } from './projection'
import { depthFactor, tiltForDistance } from './tilt'

/** The farthest a framed landing pulls back (as a follow does, followDistanceFor); BARE_MAX_DISTANCE for a bare station. */
export const FRAME_MAX_DISTANCE = 600
export const BARE_MAX_DISTANCE = FRAME_MAX_DISTANCE
/** The target stays this close to an anchor, so focus can't be lost to a short drag. */
export const TARGET_RADIUS_M = PAN_RADIUS_BARE
/** Every point is kept this far inside the free area's edges, CSS px. */
export const FRAME_PAD_PX = 12
const STEP_M = 10
/** A radius limit is the polygon of this many sides inscribed in its circle (within 2% of the radius). */
const DISC_SIDES = 16
/** A landing that frames the station alone (no entrance fits within PAN_RADIUS_BARE) may hold its target this far off. */
export const STATION_ONLY_RADIUS_M = 120

/** A point to frame: scene x/z, and its drawn height at full depth (y × yScale), which the depth factor scales. */
export interface FramePoint {
  x: number
  y: number
  z: number
}

export interface FreeFrameInput {
  /** Always framed: when these can't fit within TARGET_RADIUS_M, the frame falls back (`fallbackRadius`). */
  required: readonly FramePoint[]
  /** Framed in this order of priority, each only if it still fits with those already kept. */
  wanted: readonly FramePoint[]
  /** The point the plain landing puts mid-free (the centred target). */
  center: FramePoint
  /** The target stays within TARGET_RADIUS_M of one of these (the best: framePrefer). At least one. */
  anchors: readonly Ground[]
  /** The target stays this close to the centred target. */
  centerRadius: number
  /**
   * When the required points don't fit within TARGET_RADIUS_M they are framed alone within this; failing that, the
   * centred target is pulled within it. Default TARGET_RADIUS_M.
   */
  fallbackRadius?: number
  /** Camera azimuth (OrbitControls getAzimuthalAngle), radians. */
  azimuth: number
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
}

export interface FreeFrame {
  distance: number
  target: Ground
  /** The wanted points framed. */
  kept: FramePoint[]
}

/** One framing problem: the cached screen quads per distance and height, and the centred target per distance. */
interface Framer {
  input: FreeFrameInput
  view: FollowView
  quads: Map<string, HalfPlane[]>
  centered: Map<number, Ground>
}

function framer(input: FreeFrameInput): Framer {
  return { input, view: createFollowView(), quads: new Map(), centered: new Map() }
}

/** The view at `distance` (polar from the tilt) aimed so a point at the target lands on screen point (x, y), CSS px. */
function viewAt(f: Framer, distance: number, x: number, y: number): FollowView {
  const { viewport, free, fovDeg, azimuth } = f.input
  writeFollowView(f.view, viewport, free, fovDeg, distance, tiltForDistance(distance), azimuth)
  f.view.ndcX = (2 * x) / viewport.width - 1
  f.view.ndcY = 1 - (2 * y) / viewport.height
  return f.view
}

/**
 * The half-planes of Q, the quad of targets at `distance` that put a point at (0, h, 0) on the padded free rect's
 * corners (followTargetInto, exact under perspective; lines on a level plane stay lines on screen).
 */
function quadPlanes(f: Framer, distance: number, h: number): HalfPlane[] {
  const key = `${distance}|${h}`
  const hit = f.quads.get(key)
  if (hit) return hit
  const { free } = f.input
  const padX = Math.min(FRAME_PAD_PX, (free.right - free.left) / 2)
  const padY = Math.min(FRAME_PAD_PX, (free.bottom - free.top) / 2)
  const xs = [free.left + padX, free.right - padX]
  const ys = [free.top + padY, free.bottom - padY]
  const corners: [number, number][] = [
    [xs[0]!, ys[0]!],
    [xs[1]!, ys[0]!],
    [xs[1]!, ys[1]!],
    [xs[0]!, ys[1]!],
  ]
  const p = { x: 0, y: h, z: 0 }
  const quad = corners.map(([x, y]) => followTargetInto(p, viewAt(f, distance, x, y), { x: 0, z: 0 }))
  const planes = polygonHalfPlanes(quad)
  f.quads.set(key, planes)
  return planes
}

/**
 * The half-planes of the targets at `distance` that keep every point of `pts` inside the padded free rect: for a point
 * p at height h it is p + Q(h), so for all the points of one height it is Q(h)'s half-planes shifted by their worst.
 */
function screenPlanes(f: Framer, distance: number, pts: readonly FramePoint[]): HalfPlane[] {
  const depth = depthFactor(distance)
  const byHeight = new Map<number, FramePoint[]>()
  for (const p of pts) {
    const group = byHeight.get(p.y)
    if (group) group.push(p)
    else byHeight.set(p.y, [p])
  }
  const out: HalfPlane[] = []
  for (const [y, group] of byHeight) {
    for (const h of quadPlanes(f, distance, y * depth)) {
      let worst = Infinity
      for (const p of group) worst = Math.min(worst, h.nx * p.x + h.nz * p.z)
      out.push({ nx: h.nx, nz: h.nz, c: h.c + worst })
    }
  }
  return out
}

/** The half-planes of the DISC_SIDES-gon inscribed in the circle of radius `r` around `c`. */
function discPlanes(c: Ground, r: number): HalfPlane[] {
  const apothem = r * Math.cos(Math.PI / DISC_SIDES)
  return Array.from({ length: DISC_SIDES }, (_, i) => {
    const a = (2 * Math.PI * i) / DISC_SIDES
    const nx = Math.cos(a)
    const nz = Math.sin(a)
    return { nx, nz, c: nx * c.x + nz * c.z + apothem }
  })
}

/** The target at `distance` that puts the center mid-free (the plain landing). */
function centeredTarget(f: Framer, distance: number): Ground {
  const hit = f.centered.get(distance)
  if (hit) return hit
  const { free, center } = f.input
  const v = viewAt(f, distance, (free.left + free.right) / 2, (free.top + free.bottom) / 2)
  const t = followTargetInto({ x: center.x, y: center.y * depthFactor(distance), z: center.z }, v, { x: 0, z: 0 })
  f.centered.set(distance, t)
  return t
}

/** The nearest point to `p` within every half-plane of `planes` (and a search square of `half` around `around`), or null for none. */
function nearestWithin(around: Ground, half: number, planes: readonly HalfPlane[], p: Ground): Ground | null {
  let poly = square(around, half)
  for (const h of planes) {
    poly = clipToHalfPlane(poly, h)
    if (poly.length === 0) return null
  }
  return nearestInPolygon(poly, planes, p)
}

/** The target at exactly `distance` that keeps `pts` in the padded free rect within `radius` of `anchor`, nearest the centred target; or null. */
function targetAt(f: Framer, anchor: Ground, pts: readonly FramePoint[], distance: number, radius: number): Ground | null {
  const t0 = centeredTarget(f, distance)
  const planes = [...screenPlanes(f, distance, pts), ...discPlanes(anchor, radius), ...discPlanes(t0, f.input.centerRadius)]
  return nearestWithin(anchor, 2 * radius, planes, t0)
}

/** The fit at the smallest distance from `from` up that has one, or null. */
function fit(f: Framer, anchor: Ground, pts: readonly FramePoint[], radius: number, from = LANDING_DISTANCE): FreeFrame | null {
  for (let distance = from; distance <= FRAME_MAX_DISTANCE; distance += STEP_M) {
    const target = targetAt(f, anchor, pts, distance, radius)
    if (target) return { distance, target, kept: [] }
  }
  return null
}

const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

/** `fallback`: the required points didn't fit within TARGET_RADIUS_M. */
interface AnchorFrame extends FreeFrame {
  fallback: boolean
}

function frameFor(f: Framer, anchor: Ground): AnchorFrame {
  const { required, wanted } = f.input
  let best = fit(f, anchor, required, TARGET_RADIUS_M)
  if (!best) {
    const r = f.input.fallbackRadius ?? TARGET_RADIUS_M
    const alone = r > TARGET_RADIUS_M ? fit(f, anchor, required, r) : null
    if (alone) return { ...alone, fallback: true }
    const t0 = centeredTarget(f, LANDING_DISTANCE)
    const target = nearestWithin(anchor, 2 * r, discPlanes(anchor, r), t0) ?? { x: anchor.x, z: anchor.z }
    return { distance: LANDING_DISTANCE, target, kept: [], fallback: true }
  }
  const kept: FramePoint[] = []
  for (const p of wanted) {
    // More points never fit nearer than fewer did, so the search resumes at the last fit's distance.
    const next = fit(f, anchor, [...required, ...kept, p], TARGET_RADIUS_M, best.distance)
    if (!next) continue
    kept.push(p)
    best = next
  }
  return { ...best, kept, fallback: false }
}

/**
 * Whether `a` is the better of two anchors' frames: the required points fit; then, in the wanted order (their priority),
 * the first point one keeps and the other drops; then nearer; then nearer the centred target.
 */
function framePrefer(f: Framer, a: AnchorFrame, b: AnchorFrame): boolean {
  if (a.fallback !== b.fallback) return !a.fallback
  const [ka, kb] = [new Set(a.kept), new Set(b.kept)]
  for (const p of f.input.wanted) if (ka.has(p) !== kb.has(p)) return ka.has(p)
  if (a.distance !== b.distance) return a.distance < b.distance
  return gap(a.target, centeredTarget(f, a.distance)) < gap(b.target, centeredTarget(f, b.distance))
}

/**
 * Distance and ground target that frame `required` and as many of `wanted` as fit, in their order (one that can't is
 * skipped and the rest still get their chance), at the smallest distance in LANDING_DISTANCE..FRAME_MAX_DISTANCE
 * (10 m steps) that fits them, nearest the centred target, for the best of the anchors.
 */
export function freeFrame(input: FreeFrameInput): FreeFrame {
  if (input.anchors.length === 0) throw new Error('freeFrame needs at least one anchor')
  const f = framer(input)
  let best: AnchorFrame | null = null
  for (const anchor of input.anchors) {
    const frame = frameFor(f, anchor)
    if (!best || framePrefer(f, frame, best)) best = frame
  }
  return { distance: best!.distance, target: best!.target, kept: best!.kept }
}

/** How many of `pts` a camera at `frame` keeps inside the padded free rect (as freeFrame frames them). */
export function framedCount(
  view: Pick<FreeFrameInput, 'azimuth' | 'viewport' | 'free' | 'fovDeg'>,
  frame: Pick<FreeFrame, 'distance' | 'target'>,
  pts: readonly FramePoint[],
): number {
  const f = framer({ ...view, required: [], wanted: [], center: { x: 0, y: 0, z: 0 }, anchors: [], centerRadius: 0 })
  const { x, z } = frame.target
  return pts.filter((p) => screenPlanes(f, frame.distance, [p]).every((h) => h.nx * x + h.nz * z <= h.c + 1e-6)).length
}

export interface BareStationFrameInput {
  station: Ground
  /** The station's entrance marks on the ground (scene meters). */
  points: readonly Ground[]
  azimuth: number
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
}

export type BareStationFrame = Pick<FreeFrame, 'distance' | 'target'>

const level = (p: Ground): FramePoint => ({ x: p.x, y: 0, z: p.z })

function bareInput(i: BareStationFrameInput, wanted: readonly FramePoint[]): FreeFrameInput {
  const station = level(i.station)
  return {
    required: [station],
    wanted,
    center: station,
    anchors: [i.station],
    // So the orbit pivots on the station; on the phone panels measured for ost.11 this never cost an entrance.
    centerRadius: PAN_RADIUS_BARE,
    fallbackRadius: STATION_ONLY_RADIUS_M,
    azimuth: i.azimuth,
    viewport: i.viewport,
    free: i.free,
    fovDeg: i.fovDeg,
  }
}

/** The bare-station target at exactly `distance` that frames the station and `points` within `radius` of it, or null. */
export function bareTargetAt(input: BareStationFrameInput, points: readonly Ground[], distance: number, radius = PAN_RADIUS_BARE): Ground | null {
  const f = framer(bareInput(input, []))
  return targetAt(f, input.station, [level(input.station), ...points.map(level)], distance, radius)
}

/**
 * Distance and ground target for landing on a bare station: freeFrame with the station required and its entrances
 * wanted nearest first. When not even the station alone fits within PAN_RADIUS_BARE (a tall panel over a phone), the
 * station alone is framed within STATION_ONLY_RADIUS_M; failing that, the centred target is pulled within that radius,
 * the station possibly outside the free area.
 */
export function bareStationFrame(input: BareStationFrameInput): FreeFrame {
  const sorted = [...input.points].sort((a, b) => gap(a, input.station) - gap(b, input.station))
  return freeFrame(bareInput(input, sorted.map(level)))
}
