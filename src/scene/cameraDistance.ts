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
