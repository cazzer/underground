import { DEFAULT_TILT } from './tilt'

/** Fully revealed at the distance where the camera becomes fully isometric. */
export const REVEAL_NEAR = DEFAULT_TILT.nearDistance
/** Hidden at or beyond this camera distance. */
export const REVEAL_FAR = 320

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** Interior opacity for a camera distance: 0 at REVEAL_FAR and beyond, 1 at REVEAL_NEAR and closer. */
export function interiorOpacity(distance: number): number {
  if (!(distance < REVEAL_FAR)) return 0
  if (distance <= REVEAL_NEAR) return 1
  return smoothstep(Math.log(REVEAL_FAR / distance) / Math.log(REVEAL_FAR / REVEAL_NEAR))
}
