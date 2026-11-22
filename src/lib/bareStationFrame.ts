/**
 * Pure framing for a station with no interior: the station point and as many of its entrance marks as fit inside the
 * free area, at the smallest camera distance from the landing distance up to BARE_MAX_DISTANCE that fits them, panned
 * only as needed. The target stays within PAN_RADIUS_BARE of the station (so a short drag can't move focus past
 * ENTER_RADIUS 140) and, where the free area allows, of the centred target (so the orbit pivots on the station) and
 * nearer the station than any other station.
 */
import { clipToHalfPlane, nearestInPolygon, polygonHalfPlanes, square, type HalfPlane } from './convexRegion'
import { createFollowView, followTargetInto, writeFollowView, type FollowView } from './follow'
import type { Viewport } from './framing'
import { LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import { PAN_RADIUS_BARE } from './orbitLimits'
import type { Ground } from './projection'
import { tiltForDistance } from './tilt'

/** The farthest a bare-station landing pulls back to fit its entrances (as a follow does, followDistanceFor). */
export const BARE_MAX_DISTANCE = 600
/** Every point is kept this far inside the free area's edges, CSS px. */
export const FRAME_PAD_PX = 12
const STEP_M = 10
/** A radius limit is the polygon of this many sides inscribed in its circle (within 2% of the radius). */
const DISC_SIDES = 16
/** The target keeps this far on the station's side of the bisector with each neighbour, so it is strictly nearer. */
const CELL_MARGIN_M = 1

export interface BareStationFrameInput {
  station: Ground
  /** The station's entrance marks on the ground (scene meters). */
  points: readonly Ground[]
  /** Other stations' points near this one: the target stays nearer this station than any of them. */
  others: readonly Ground[]
  /** Camera azimuth (OrbitControls getAzimuthalAngle), radians. */
  azimuth: number
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
}

export interface BareStationFrame {
  distance: number
  target: Ground
}

const ORIGIN = { x: 0, y: 0, z: 0 }

/** The view at `distance` (polar from the tilt) aimed so a point at the target lands on screen point (x, y), CSS px. */
function viewAt(v: FollowView, input: BareStationFrameInput, distance: number, x: number, y: number): FollowView {
  writeFollowView(v, input.viewport, input.free, input.fovDeg, distance, tiltForDistance(distance), input.azimuth)
  v.ndcX = (2 * x) / input.viewport.width - 1
  v.ndcY = 1 - (2 * y) / input.viewport.height
  return v
}

/**
 * The half-planes of the targets at `distance` that keep every point of `pts` inside the padded free rect. For one
 * point p it is p + Q, Q the quad of targets that put the origin on the padded rect's corners (followTargetInto, exact
 * under perspective; lines on the ground stay lines on screen), so for all of them it is Q's half-planes shifted by
 * each point's worst.
 */
function screenPlanes(input: BareStationFrameInput, distance: number, pts: readonly Ground[]): HalfPlane[] {
  const { free } = input
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
  const v = createFollowView()
  const quad = corners.map(([x, y]) => followTargetInto(ORIGIN, viewAt(v, input, distance, x, y), { x: 0, z: 0 }))
  return polygonHalfPlanes(quad).map((h) => {
    let worst = Infinity
    for (const p of pts) worst = Math.min(worst, h.nx * p.x + h.nz * p.z)
    return { nx: h.nx, nz: h.nz, c: h.c + worst }
  })
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

/** The targets at least CELL_MARGIN_M nearer `s` than each of `others`'s bisector: one half-plane per other station. */
function cellPlanes(s: Ground, others: readonly Ground[]): HalfPlane[] {
  return others.map((o) => {
    const nx = o.x - s.x
    const nz = o.z - s.z
    return { nx, nz, c: (nx * (o.x + s.x) + nz * (o.z + s.z)) / 2 - CELL_MARGIN_M * Math.hypot(nx, nz) }
  })
}

/** The target at `distance` that puts the station mid-free (the plain landing). */
function centeredTarget(input: BareStationFrameInput, distance: number): Ground {
  const { free } = input
  const v = viewAt(createFollowView(), input, distance, (free.left + free.right) / 2, (free.top + free.bottom) / 2)
  return followTargetInto({ x: input.station.x, y: 0, z: input.station.z }, v, { x: 0, z: 0 })
}

/** The nearest point to `p` within every half-plane of `planes` (and the station's search square), or null for none. */
function nearestWithin(station: Ground, planes: readonly HalfPlane[], p: Ground): Ground | null {
  let poly = square(station, 2 * PAN_RADIUS_BARE)
  for (const h of planes) {
    poly = clipToHalfPlane(poly, h)
    if (poly.length === 0) return null
  }
  return nearestInPolygon(poly, planes, p)
}

/**
 * The target at exactly `distance` that keeps the station and `points` in the padded free rect within PAN_RADIUS_BARE
 * of the station, nearest the centred target; or null when none does. `strict` also holds it within PAN_RADIUS_BARE
 * of the centred target and nearer the station than any of `others`.
 */
export function bareTargetAt(input: BareStationFrameInput, points: readonly Ground[], distance: number, strict = true): Ground | null {
  const t0 = centeredTarget(input, distance)
  const planes = [...screenPlanes(input, distance, [input.station, ...points]), ...discPlanes(input.station, PAN_RADIUS_BARE)]
  if (strict) planes.push(...discPlanes(t0, PAN_RADIUS_BARE), ...cellPlanes(input.station, input.others))
  return nearestWithin(input.station, planes, t0)
}

/** The fit at the smallest distance in range that has one, or null. */
function fit(input: BareStationFrameInput, points: readonly Ground[], strict: boolean): BareStationFrame | null {
  for (let distance = LANDING_DISTANCE; distance <= BARE_MAX_DISTANCE; distance += STEP_M) {
    const target = bareTargetAt(input, points, distance, strict)
    if (target) return { distance, target }
  }
  return null
}

const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

/**
 * Distance and ground target for landing on a bare station: bareTargetAt at the smallest distance in
 * LANDING_DISTANCE..BARE_MAX_DISTANCE (10 m steps) that has one. Entrances join nearest first, each only if the fit
 * still succeeds with it, so one that can't fit is skipped and the rest still get their chance. The strict limits
 * (near the centred target, nearer this station than its neighbours) give way before the station itself would leave
 * the free area: a tall panel over a phone can leave no target that keeps both (focus still holds: it only moves
 * once the target is ENTER_RADIUS from the focused station, focusMachine.ts). When not even that fits, it is the
 * centred target pulled within PAN_RADIUS_BARE of the station, the station possibly outside the free area.
 */
export function bareStationFrame(input: BareStationFrameInput): BareStationFrame {
  const sorted = [...input.points].sort((a, b) => gap(a, input.station) - gap(b, input.station))
  const kept: Ground[] = []
  let strict = true
  let best = fit(input, kept, strict)
  if (!best) {
    strict = false
    best = fit(input, kept, strict)
  }
  if (!best) {
    const t0 = centeredTarget(input, LANDING_DISTANCE)
    return { distance: LANDING_DISTANCE, target: nearestWithin(input.station, discPlanes(input.station, PAN_RADIUS_BARE), t0) ?? input.station }
  }
  for (const p of sorted) {
    const f = fit(input, [...kept, p], strict)
    if (!f) continue
    kept.push(p)
    best = f
  }
  return best
}
