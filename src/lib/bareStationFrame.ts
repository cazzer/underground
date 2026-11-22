/**
 * Pure framing for a station with no interior: the station point and its entrance marks inside the free area, at the
 * smallest camera distance from the landing distance up to BARE_MAX_DISTANCE that fits them, panned only as needed,
 * with the target held within TARGET_RADIUS_M of the station so its focus holds (ENTER_RADIUS 140).
 */
import { clipToHalfPlane, nearestInPolygon, polygonHalfPlanes, square, type HalfPlane } from './convexRegion'
import { createFollowView, followTargetInto, writeFollowView, type FollowView } from './follow'
import type { Viewport } from './framing'
import { LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import type { Ground } from './projection'
import { tiltForDistance } from './tilt'

/** The farthest a bare-station landing pulls back to fit its entrances (as a follow does, followDistanceFor). */
export const BARE_MAX_DISTANCE = 600
/** The landing target stays this close to the station point, so the station's own focus holds (ENTER_RADIUS 140). */
export const TARGET_RADIUS_M = 120
/** Every point is kept this far inside the free area's edges, CSS px. */
export const FRAME_PAD_PX = 12
const STEP_M = 10
/** The candidate targets start as a square this big around the station before the fit cuts it down. */
const SEARCH_HALF_M = 10_000

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
 * The targets at `distance` that keep every point of `pts` inside the padded free rect. For one point p it is p + Q,
 * Q the quad of targets that put the origin on the padded rect's corners (followTargetInto, exact under perspective;
 * lines on the ground stay lines on screen), so for all of them it is Q's half-planes shifted by each point's worst.
 */
function feasibleTargets(input: BareStationFrameInput, distance: number, pts: readonly Ground[]): { poly: Ground[]; planes: HalfPlane[] } {
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
  let poly = square(input.station, SEARCH_HALF_M)
  const planes = polygonHalfPlanes(quad).map((h) => {
    let worst = Infinity
    for (const p of pts) worst = Math.min(worst, h.nx * p.x + h.nz * p.z)
    return { nx: h.nx, nz: h.nz, c: h.c + worst }
  })
  for (const h of planes) poly = clipToHalfPlane(poly, h)
  return { poly, planes }
}

/** The target at `distance` that puts the station mid-free (the plain landing). */
function centeredTarget(input: BareStationFrameInput, distance: number): Ground {
  const { free } = input
  const v = viewAt(createFollowView(), input, distance, (free.left + free.right) / 2, (free.top + free.bottom) / 2)
  return followTargetInto({ x: input.station.x, y: 0, z: input.station.z }, v, { x: 0, z: 0 })
}

const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

/** `p` pulled toward `s` until it is within `r` of it. */
function clampToDisc(p: Ground, s: Ground, r: number): Ground {
  const d = gap(p, s)
  if (d <= r) return p
  return { x: s.x + ((p.x - s.x) * r) / d, z: s.z + ((p.z - s.z) * r) / d }
}

/** Where the segment from `b` (inside the disc) to `a` (outside) crosses the disc of radius `r` around `s`. */
function exitPoint(b: Ground, a: Ground, s: Ground, r: number): Ground {
  const dx = a.x - b.x
  const dz = a.z - b.z
  const fx = b.x - s.x
  const fz = b.z - s.z
  const qa = dx * dx + dz * dz
  const qb = 2 * (fx * dx + fz * dz)
  const qc = fx * fx + fz * fz - r * r
  const t = qa === 0 ? 0 : (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa)
  return { x: b.x + dx * t, z: b.z + dz * t }
}

/** The fit for exactly these points, or null when no distance in range fits them within the target radius. */
function fit(input: BareStationFrameInput, points: readonly Ground[]): BareStationFrame | null {
  const pts = [input.station, ...points]
  for (let distance = LANDING_DISTANCE; distance <= BARE_MAX_DISTANCE; distance += STEP_M) {
    const { poly, planes } = feasibleTargets(input, distance, pts)
    if (poly.length === 0) continue
    const near = nearestInPolygon(poly, planes, input.station)
    if (gap(near, input.station) > TARGET_RADIUS_M) continue
    const t0 = centeredTarget(input, distance)
    const best = nearestInPolygon(poly, planes, t0)
    const target = gap(best, input.station) <= TARGET_RADIUS_M ? best : exitPoint(near, best, input.station, TARGET_RADIUS_M)
    return { distance, target }
  }
  return null
}

/**
 * Distance and ground target for landing on a bare station: the smallest distance in LANDING_DISTANCE..
 * BARE_MAX_DISTANCE (10 m steps, the polar the tilt gives it) at which the station and every point fit the free rect
 * less FRAME_PAD_PX with a target within TARGET_RADIUS_M of the station, and then the target nearest the one that
 * centers the station (so it pans only as needed). When nothing fits, the point farthest from the station is
 * dropped and the fit tried again; with no points left it is the centered landing, pulled within the radius.
 */
export function bareStationFrame(input: BareStationFrameInput): BareStationFrame {
  const points = [...input.points].sort((a, b) => gap(a, input.station) - gap(b, input.station))
  while (points.length > 0) {
    const f = fit(input, points)
    if (f) return f
    points.pop()
  }
  return { distance: LANDING_DISTANCE, target: clampToDisc(centeredTarget(input, LANDING_DISTANCE), input.station, TARGET_RADIUS_M) }
}
