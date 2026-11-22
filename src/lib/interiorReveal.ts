/**
 * The interior fades in as a flat plan between these camera distances, while the camera is still only slightly
 * tipped (tilt 1450 to 400 m; depth is about 0.17 at 1250 m and 0.46 at 1000 m), so the levels only separate
 * afterwards. The far end is where the tilt first shows; at the near end a drawn level gap covers the same share of
 * the screen (depth x sin(polar) / distance) as it did at 800 m on the older, later tilt.
 */
export const REVEAL_NEAR = 1000
/** Hidden at or beyond this camera distance. */
export const REVEAL_FAR = 1250

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** Interior opacity for a camera distance: 0 at REVEAL_FAR and beyond, 1 at REVEAL_NEAR and closer. */
export function interiorOpacity(distance: number): number {
  if (!(distance < REVEAL_FAR)) return 0
  if (distance <= REVEAL_NEAR) return 1
  return smoothstep(Math.log(REVEAL_FAR / distance) / Math.log(REVEAL_FAR / REVEAL_NEAR))
}

/**
 * How much of the street veil (and the platform trains' veil tint) shows: the interior's opacity times the depth
 * factor (tilt.ts), so the street dims only as the interior's levels separate, not while it lies flat as a plan.
 */
export function veilWeight(opacity: number, depth: number): number {
  return opacity * depth
}

/**
 * Level labels show from this depth factor and are fully in by LABELS_FULL_DEPTH: a flat plan has no levels to name.
 * The tilt now reaches a depth farther out, where a level gap is smaller on screen, so these sit 0.05 above the
 * older 0.3 and 0.6 to show at the same on-screen gap.
 */
export const LABELS_FROM_DEPTH = 0.35
export const LABELS_FULL_DEPTH = 0.65

/** Level label opacity: the interior's opacity, gated on the depth factor between the two label depths. */
export function labelOpacity(opacity: number, depth: number): number {
  const t = Math.min(Math.max((depth - LABELS_FROM_DEPTH) / (LABELS_FULL_DEPTH - LABELS_FROM_DEPTH), 0), 1)
  return opacity * smoothstep(t)
}
