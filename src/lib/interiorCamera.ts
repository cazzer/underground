/** Pure camera framing for a station interior beside the HUD. */
import type { Insets, Viewport } from './framing'
import { REVEAL_NEAR } from './interiorReveal'
import { rotateScreenOffset } from './orbitLimits'
import type { Ground } from './projection'
import { ISO_POLAR } from './tilt'

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
 * Camera distance and ground target for an interior fly-to. The distance is always REVEAL_NEAR,
 * where the view is exactly isometric and the interior fully revealed: pulling back to fit a small
 * screen would fade it out and drop the focus, so a big interior gets a partial fit instead. The
 * target only shifts (freeCenterShift plus the depth term, turned by the camera azimuth into ground
 * x/z), so the interior's mid-depth center lands mid-`free`.
 */
export function frameInterior({ center, towardCamera, azimuth, viewport, free, fovDeg }: InteriorFrameInput): { distance: number; target: Ground } {
  const distance = REVEAL_NEAR
  const s = freeCenterShift(viewport, free, fovDeg, distance, ISO_POLAR, { right: 0, toward: 0 })
  const shift = rotateScreenOffset(s.right, s.toward + towardCamera, azimuth)
  return { distance, target: { x: center.x + shift.x, z: center.z + shift.z } }
}
