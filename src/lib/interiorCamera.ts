/** Pure camera framing for a station interior beside the HUD. */
import type { Insets, Viewport } from './framing'
import type { Ground } from './projection'

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
  /** Plan extent in meters: east-west and north-south. */
  width: number
  length: number
  /** Scaled depth of the deepest level, meters (positive). */
  depth: number
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
  /** Camera polar angle from vertical, radians. */
  polar: number
  /** Never closer than this (the full-reveal distance). */
  minDistance: number
  /** Screen padding kept clear on every side of the free rect, CSS px. */
  pad?: number
}

/**
 * Camera distance and ground target that fit the interior's screen footprint inside `free` and
 * center it there. Screen x is east; a screen-vertical pixel covers metersPerPx / cos(polar) of
 * ground north-south, and depth shows at sin(polar).
 */
export function frameInterior(input: InteriorFrameInput): { distance: number; target: Ground } {
  const { center, viewport, free, polar, pad = 24 } = input
  const tanHalf = Math.tan((input.fovDeg * Math.PI) / 360)
  const freeW = Math.max(free.right - free.left - 2 * pad, 1)
  const freeH = Math.max(free.bottom - free.top - 2 * pad, 1)
  const screenW = input.width
  const screenH = input.length * Math.cos(polar) + input.depth * Math.sin(polar)
  // Fitting a span of s meters into p px needs metersPerPx >= s / p.
  const fitDistance = (s: number, p: number) => (s / p) * (viewport.height / (2 * tanHalf))
  const distance = Math.max(input.minDistance, fitDistance(screenW, freeW), fitDistance(screenH, freeH))
  const metersPerPx = (2 * distance * tanHalf) / viewport.height
  const dx = viewport.width / 2 - (free.left + free.right) / 2
  const dy = viewport.height / 2 - (free.top + free.bottom) / 2
  return {
    distance,
    target: { x: center.x + dx * metersPerPx, z: center.z + (dy * metersPerPx) / Math.cos(polar) },
  }
}
