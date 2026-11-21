/** Pure camera framing for a station interior beside the HUD. */
import type { Insets, Viewport } from './framing'
import { rotateScreenOffset, wrapAngle } from './orbitLimits'
import type { Ground } from './projection'
import { DEFAULT_TILT, ISO_POLAR } from './tilt'

/**
 * Camera distance a station click lands at, with or without an interior: the tilt's near distance, where
 * the view is exactly isometric and every depth fully drawn.
 */
export const LANDING_DISTANCE = DEFAULT_TILT.nearDistance

/** Screen rectangle in CSS px, viewport-relative. */
export interface ScreenRect {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The part of the viewport the interior may use: between the header and footer bands, and left of
 * the station panel when it sits on the right (desktop), or above it when it is stacked (phone).
 */
export function interiorFreeRect(viewport: Viewport, insets: Insets, panel: ScreenRect | null, gap = 16): ScreenRect {
  const free = { left: 0, top: insets.top, right: viewport.width, bottom: viewport.height - insets.bottom }
  if (!panel) return free
  if (panel.left > viewport.width / 2) free.right = Math.max(panel.left - gap, 1)
  else free.bottom = Math.max(Math.min(free.bottom, panel.top - gap), free.top + 1)
  return free
}

export interface InteriorFrameInput {
  /** Ground point under the interior's plan center (interiorFocusAnchor). */
  center: Ground
  /** Meters toward the camera that line the mid-depth center up with `center` (interiorFocusAnchor). */
  towardCamera: number
  /** Camera azimuth (OrbitControls getAzimuthalAngle), radians; 0 = looking north. */
  azimuth: number
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
}

/** A ground offset in the screen's frame: meters along screen-right and toward the camera. */
export interface ScreenShift {
  right: number
  toward: number
}

/**
 * How far the view center sits from the ground point under the middle of `free`, in the screen's
 * frame, written into `out` (no allocation, so it can run per frame). A screen-horizontal pixel
 * covers metersPerPx along screen-right and a vertical one metersPerPx / cos(polar) toward the camera,
 * sized at the target's `distance`.
 */
export function freeCenterShift(
  viewport: Viewport,
  free: ScreenRect,
  fovDeg: number,
  distance: number,
  polar: number,
  out: ScreenShift,
): ScreenShift {
  const metersPerPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewport.height
  out.right = (viewport.width / 2 - (free.left + free.right) / 2) * metersPerPx
  out.toward = ((viewport.height / 2 - (free.top + free.bottom) / 2) * metersPerPx) / Math.cos(polar)
  return out
}

/**
 * How much more ground the free area must cover top to bottom than across before a landing turns the
 * view. A phone with its panel stacked below is about 1.8; a desktop beside its panel about 1.15, which
 * keeps its azimuth.
 */
export const PORTRAIT_GROUND_RATIO = 1.5

/**
 * How far off screen-vertical a portrait landing leaves the platform axis, radians (30°): most of the fit
 * gain of a straight-up axis, while the levels still read apart in the isometric view.
 */
export const LANDING_AXIS_OFF_VERTICAL = (30 * Math.PI) / 180

/**
 * Camera azimuth for landing on an interior whose platforms run along `axis` (unit plan vector, x east,
 * z south). When the free area is portrait in ground terms (PORTRAIT_GROUND_RATIO; screen-vertical ground
 * spans 1 / cos(ISO_POLAR) times the pixels a horizontal one does), the view turns just far enough that the
 * axis runs within LANDING_AXIS_OFF_VERTICAL of screen-vertical, so a long station fits along the free
 * area's long side; already within it, or on a landscape free area, the view keeps `current`.
 */
export function landingAzimuth(axis: readonly [number, number], current: number, free: ScreenRect): number {
  const across = free.right - free.left
  const upDown = (free.bottom - free.top) / Math.cos(ISO_POLAR)
  if (upDown < across * PORTRAIT_GROUND_RATIO) return current
  // At azimuth θ the camera sits along (sin θ, cos θ) from the target, which is screen-vertical on the ground.
  const along = Math.atan2(axis[0], axis[1])
  // The axis's angle off vertical at `current`, folded into (-90°, 90°]: the axis has no head or tail.
  let off = wrapAngle(current - along)
  if (off > Math.PI / 2) off -= Math.PI
  else if (off <= -Math.PI / 2) off += Math.PI
  if (Math.abs(off) <= LANDING_AXIS_OFF_VERTICAL) return current
  return wrapAngle(current - off + Math.sign(off) * LANDING_AXIS_OFF_VERTICAL)
}

/**
 * Camera distance and ground target for an interior fly-to. The distance is always LANDING_DISTANCE,
 * where the view is exactly isometric and the interior fully revealed: pulling back to fit a small
 * screen would flatten it, so a big interior gets a partial fit instead. The
 * target only shifts (freeCenterShift plus the depth term, turned by the camera azimuth into ground
 * x/z), so the interior's mid-depth center lands mid-`free`.
 */
export function frameInterior({ center, towardCamera, azimuth, viewport, free, fovDeg }: InteriorFrameInput): { distance: number; target: Ground } {
  const distance = LANDING_DISTANCE
  const s = freeCenterShift(viewport, free, fovDeg, distance, ISO_POLAR, { right: 0, toward: 0 })
  const shift = rotateScreenOffset(s.right, s.toward + towardCamera, azimuth)
  return { distance, target: { x: center.x + shift.x, z: center.z + shift.z } }
}
