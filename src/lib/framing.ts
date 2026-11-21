import type { Bounds } from './network'
import type { Ground } from './projection'

export function boundsCenter(b: Bounds): Ground {
  return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 }
}

/**
 * Top-down camera distance that fits `bounds` in a perspective view with vertical field of
 * view `fovDeg` and viewport `aspect` (width / height), padded by `margin`.
 */
export function fitDistance(bounds: Bounds, aspect: number, fovDeg = 35, margin = 1.1): number {
  const halfW = (bounds.maxX - bounds.minX) / 2
  const halfH = (bounds.maxZ - bounds.minZ) / 2
  const halfFov = (fovDeg * Math.PI) / 360
  return (Math.max(halfH, halfW / aspect) / Math.tan(halfFov)) * margin
}

/** Screen space (CSS px) covered by HUD at the top and bottom of the viewport. */
export interface Insets {
  top: number
  bottom: number
}

export interface Viewport {
  width: number
  height: number
}

/**
 * Top-down framing that fits `bounds` into the part of the viewport between the HUD insets.
 * Returns the camera distance and the view target (the point at the viewport center), which is
 * shifted north or south so the bounds sit centered in the free band.
 */
export function frameBounds(
  bounds: Bounds,
  viewport: Viewport,
  insets: Insets,
  fovDeg = 35,
  margin = 1.1,
): { distance: number; target: Ground } {
  const free = Math.max(viewport.height - insets.top - insets.bottom, 1)
  // Fit as if the viewport were only the free band, then pull back so that band is that tall.
  const distance = fitDistance(bounds, viewport.width / free, fovDeg, margin) * (viewport.height / free)
  const metersPerPx = (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / viewport.height
  const center = boundsCenter(bounds)
  // Screen down is +z. The free band's center is (top - bottom) / 2 px below the viewport center.
  return { distance, target: { x: center.x, z: center.z - ((insets.top - insets.bottom) / 2) * metersPerPx } }
}
