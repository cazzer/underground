/**
 * Pure framing for a station with no interior: the station point and as many of its entrance marks as fit inside the
 * free area, at the smallest camera distance from the landing distance up to BARE_MAX_DISTANCE that fits them, panned
 * only as needed. The target stays within PAN_RADIUS_BARE of the station (so a short drag can't move focus past
 * ENTER_RADIUS 140), or STATION_ONLY_RADIUS_M when only the station fits, and within PAN_RADIUS_BARE of the centred
 * target (so the orbit pivots on the station).
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
/** A landing that frames the station alone (no entrance fits within PAN_RADIUS_BARE) may hold its target this far off. */
export const STATION_ONLY_RADIUS_M = 120

export interface BareStationFrameInput {
  station: Ground
  /** The station's entrance marks on the ground (scene meters). */
  points: readonly Ground[]
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

/** The target at `distance` that puts the station mid-free (the plain landing). */
function centeredTarget(input: BareStationFrameInput, distance: number): Ground {
  const { free } = input
  const v = viewAt(createFollowView(), input, distance, (free.left + free.right) / 2, (free.top + free.bottom) / 2)
  return followTargetInto({ x: input.station.x, y: 0, z: input.station.z }, v, { x: 0, z: 0 })
}

/** The nearest point to `p` within every half-plane of `planes` (and a search square of `half` around the station), or null for none. */
function nearestWithin(station: Ground, half: number, planes: readonly HalfPlane[], p: Ground): Ground | null {
  let poly = square(station, half)
  for (const h of planes) {
    poly = clipToHalfPlane(poly, h)
    if (poly.length === 0) return null
  }
  return nearestInPolygon(poly, planes, p)
}

/**
 * The target at exactly `distance` that keeps the station and `points` in the padded free rect, within `radius` of
 * the station and PAN_RADIUS_BARE of the centred target (so the orbit pivots on the station; on the phone panels
 * measured for ost.11 this never cost an entrance), nearest the centred target; or null when none does.
 */
export function bareTargetAt(input: BareStationFrameInput, points: readonly Ground[], distance: number, radius = PAN_RADIUS_BARE): Ground | null {
  const t0 = centeredTarget(input, distance)
  const planes = [
    ...screenPlanes(input, distance, [input.station, ...points]),
    ...discPlanes(input.station, radius),
    ...discPlanes(t0, PAN_RADIUS_BARE),
  ]
  return nearestWithin(input.station, 2 * radius, planes, t0)
}

/** The fit at the smallest distance in range that has one, or null. */
function fit(input: BareStationFrameInput, points: readonly Ground[], radius = PAN_RADIUS_BARE): BareStationFrame | null {
  for (let distance = LANDING_DISTANCE; distance <= BARE_MAX_DISTANCE; distance += STEP_M) {
    const target = bareTargetAt(input, points, distance, radius)
    if (target) return { distance, target }
  }
  return null
}

const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

/**
 * Distance and ground target for landing on a bare station: bareTargetAt at the smallest distance in
 * LANDING_DISTANCE..BARE_MAX_DISTANCE (10 m steps) that has one. Entrances join nearest first, each only if the fit
 * still succeeds with it, so one that can't fit is skipped and the rest still get their chance; any entrance framed
 * holds the target within PAN_RADIUS_BARE. When not even the station alone fits within it (a tall panel over a
 * phone), the station alone is framed within STATION_ONLY_RADIUS_M; failing that, the centred target is pulled
 * within that radius, the station possibly outside the free area.
 */
export function bareStationFrame(input: BareStationFrameInput): BareStationFrame {
  const sorted = [...input.points].sort((a, b) => gap(a, input.station) - gap(b, input.station))
  const kept: Ground[] = []
  let best = fit(input, kept)
  if (!best) {
    const alone = fit(input, kept, STATION_ONLY_RADIUS_M)
    if (alone) return alone
    const t0 = centeredTarget(input, LANDING_DISTANCE)
    const r = STATION_ONLY_RADIUS_M
    return { distance: LANDING_DISTANCE, target: nearestWithin(input.station, 2 * r, discPlanes(input.station, r), t0) ?? input.station }
  }
  for (const p of sorted) {
    const f = fit(input, [...kept, p])
    if (!f) continue
    kept.push(p)
    best = f
  }
  return best
}
