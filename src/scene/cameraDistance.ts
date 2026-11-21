import type { RootState } from '@react-three/fiber'
import type { Vector3 } from 'three'

interface HasTarget {
  target: Vector3
}

export function getControls(state: RootState): HasTarget | null {
  return (state.controls as HasTarget | null) ?? null
}

/** Distance (meters) from the camera to the point it orbits. */
export function cameraDistance(state: RootState): number {
  const controls = getControls(state)
  return controls ? state.camera.position.distanceTo(controls.target) : state.camera.position.length()
}

/**
 * Scene-unit size that keeps something roughly `px` screen pixels at the given camera distance,
 * but never smaller than `minMeters` so it stays a real-world-sized object when zoomed in.
 */
export function screenScale(distance: number, px: number, minMeters: number): number {
  return Math.max(distance * px * 0.0008, minMeters)
}

/**
 * Marker radius ramp: small enough at the city overview that dense Manhattan doesn't blob.
 * About 3 px at the landscape fit (~76 km), 2 px at the portrait fit (~159 km).
 */
const MARKER_FAR = { distance: 150_000, px: 2 }
const MARKER_NEAR = { distance: 4_000, px: 7 }

/** Station marker radius in screen pixels for a camera distance; log-linear between the ends. */
export function markerRadiusPx(distance: number): number {
  if (distance >= MARKER_FAR.distance) return MARKER_FAR.px
  if (distance <= MARKER_NEAR.distance) return MARKER_NEAR.px
  const t = Math.log(MARKER_FAR.distance / distance) / Math.log(MARKER_FAR.distance / MARKER_NEAR.distance)
  return MARKER_FAR.px + (MARKER_NEAR.px - MARKER_FAR.px) * t
}
