/**
 * Where a covered station's amenity row (StationAmenities.tsx, enp.5) sits past its interior: just off the
 * footprint's hull, on a side whose row a landing on that interior shows inside the free rect. Pure.
 */
import { bandReach, BEARINGS, rowCentreInto, rightX, rightZ, TIE_M } from './amenityPlacement'
import type { Viewport } from './framing'
import type { Footprint } from './interiorFootprint'
import { frameInterior, landingAzimuth, type ScreenRect } from './interiorCamera'
import type { FocusAnchor } from './interiorFraming'
import type { Ground } from './projection'
import { tiltForDistance } from './tilt'

/** How far a row's plates keep inside the free rect at the landing, px. */
export const COVERED_PAD_PX = 4

/** The landing a row is checked at: the viewport, its free rect and the field of view. */
export interface LandingView {
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
}

/** The marks' sizes at LANDING_DISTANCE (amenitySizes' markSizesInto), meters. */
export interface RowSizes {
  plate: number
  gap: number
  clear: number
}

export interface CoveredRow {
  /** The hull's middle (its vertices' mean), the row's origin. */
  origin: Ground
  dir: Ground
  /** How far past the origin along `dir` the row starts (the hull's reach plus `extraM`). */
  reach: number
  /** Whether the row lies inside the free rect at the landing (false: no side does, and this is the nearest side). */
  fits: boolean
}

/** Screen px of ground point (x, z) for an orbit camera at `distance`, `polar`, `azimuth` about `target`. Null behind it. */
export function orbitProjector(target: Ground, distance: number, polar: number, azimuth: number, viewport: Viewport, fovDeg: number) {
  const bx = Math.sin(polar) * Math.sin(azimuth)
  const by = Math.cos(polar)
  const bz = Math.sin(polar) * Math.cos(azimuth)
  const cam = { x: target.x + bx * distance, y: by * distance, z: target.z + bz * distance }
  // Forward f = -b; right = f × up, normalized; up' = right × f.
  const fx = -bx
  const fy = -by
  const fz = -bz
  const rl = Math.hypot(fz, fx) || 1
  const rx = -fz / rl
  const rz = fx / rl
  const ux = -rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy
  const tanHalf = Math.tan((fovDeg * Math.PI) / 360)
  const aspect = viewport.width / viewport.height
  return (x: number, z: number): { x: number; y: number } | null => {
    const vx = x - cam.x
    const vy = -cam.y
    const vz = z - cam.z
    const depth = vx * fx + vy * fy + vz * fz
    if (!(depth > 0)) return null
    const sx = (vx * rx + vz * rz) / (depth * tanHalf * aspect)
    const sy = (vx * ux + vy * uy + vz * uz) / (depth * tanHalf)
    return { x: ((sx + 1) / 2) * viewport.width, y: ((1 - sy) / 2) * viewport.height }
  }
}

/**
 * The row of `n` marks for an interior (its pick `footprint`, `focusAnchor` and platform `axis`): from the hull's
 * middle along the bearing (of BEARINGS) in which the hull, within the band the row covers (bandReach), reaches
 * least, plus `extraM`, among those whose every plate
 * a landing on the interior (landingAzimuth from north-up, frameInterior at LANDING_DISTANCE, as interiorFlight lands)
 * shows inside the free rect less COVERED_PAD_PX; a near-tie within TIE_M goes to the earlier bearing. With no side in
 * view, the nearest side (`fits` false).
 */
export function coveredRow(
  footprint: Footprint,
  focusAnchor: FocusAnchor,
  axis: readonly [number, number],
  n: number,
  sizes: RowSizes,
  extraM: number,
  view: LandingView,
): CoveredRow {
  let x = 0
  let z = 0
  for (const [hx, hz] of footprint.hull) {
    x += hx
    z += hz
  }
  const m = Math.max(footprint.hull.length, 1)
  const origin = { x: footprint.originX + x / m, z: footprint.originZ + z / m }
  const az = landingAzimuth(axis, 0, view.free)
  const { distance, target } = frameInterior({ ...focusAnchor, azimuth: az, viewport: view.viewport, free: view.free, fovDeg: view.fovDeg })
  const toPx = orbitProjector(target, distance, tiltForDistance(distance), az, view.viewport, view.fovDeg)
  const { free } = view
  const c = { x: 0, z: 0 }
  const fits = (dir: Ground, reach: number): boolean => {
    for (let k = 0; k < n; k++) {
      rowCentreInto(c, k, n, origin, dir, Math.max(reach, sizes.clear), sizes.plate, sizes.gap, az)
      for (let j = 0; j < 4; j++) {
        const a = j & 1 ? 1 : -1
        const b = j & 2 ? 1 : -1
        // The plate's corners: local x is the screen's right, local z toward the camera.
        const px = toPx(c.x + sizes.plate * (a * rightX(az) - b * rightZ(az)), c.z + sizes.plate * (a * rightZ(az) + b * rightX(az)))
        if (!px || px.x < free.left + COVERED_PAD_PX || px.x > free.right - COVERED_PAD_PX || px.y < free.top + COVERED_PAD_PX || px.y > free.bottom - COVERED_PAD_PX) return false
      }
    }
    return true
  }
  // Each bearing's reach: the hull within the lateral band its row covers (a corner, not the farthest vertex).
  const reachOf = (dir: Ground): number => {
    let lo = Infinity
    let hi = -Infinity
    for (let k = 0; k < n; k++) {
      rowCentreInto(c, k, n, origin, dir, 0, sizes.plate, sizes.gap, az)
      const v = -(c.x - origin.x) * dir.z + (c.z - origin.z) * dir.x
      lo = Math.min(lo, v - sizes.plate * Math.SQRT2)
      hi = Math.max(hi, v + sizes.plate * Math.SQRT2)
    }
    return bandReach(footprint, origin, dir, lo, hi)
  }
  const options = BEARINGS.map((dir, i) => ({ dir, i, reach: reachOf(dir) + extraM }))
  // Nearest side first, by TIE_M bands; within a band, BEARINGS' preference.
  const band = (r: number) => Math.floor(r / TIE_M)
  options.sort((p, q) => band(p.reach) - band(q.reach) || p.i - q.i)
  const hit = options.find((o) => fits(o.dir, o.reach))
  const pick = hit ?? options[0]!
  return { origin, dir: pick.dir, reach: pick.reach, fits: hit !== undefined }
}
