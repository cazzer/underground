/** Pure camera framing for a station interior beside the HUD. */
import type { Insets, Viewport } from './framing'
import { REVEAL_NEAR } from './interiorReveal'
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
  /** Ground target that puts the interior's plan center at mid-depth mid-screen (interiorFocusTarget). */
  center: Ground
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
}

/**
 * Camera distance and ground target for an interior fly-to. The distance is always REVEAL_NEAR,
 * where the view is exactly isometric and the interior fully revealed: pulling back to fit a small
 * screen would fade it out and drop the focus, so a big interior gets a partial fit instead. The
 * target only shifts, so the interior's mid-depth center lands mid-`free`. Screen x is east; a
 * screen-vertical pixel covers metersPerPx / cos(ISO_POLAR) of ground north-south.
 */
export function frameInterior({ center, viewport, free, fovDeg }: InteriorFrameInput): { distance: number; target: Ground } {
  const distance = REVEAL_NEAR
  const metersPerPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewport.height
  const dx = viewport.width / 2 - (free.left + free.right) / 2
  const dy = viewport.height / 2 - (free.top + free.bottom) / 2
  return {
    distance,
    target: { x: center.x + dx * metersPerPx, z: center.z + (dy * metersPerPx) / Math.cos(ISO_POLAR) },
  }
}
