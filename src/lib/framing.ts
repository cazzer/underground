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
