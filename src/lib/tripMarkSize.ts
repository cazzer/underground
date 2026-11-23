/**
 * Sizes of the trip's station marks (TripMarks.tsx) and of a focus ring around one (FocusRing.tsx). Pure, allocation-free:
 * all world meters, from the mark's base radius (screenScale of tripMarkRadiusPx) at the current camera distance.
 */
import type { Ground } from './projection'
import type { TripMarkRole } from './tripMarks'

/** A change mark's radius as a share of a start or end mark's: the journey's ends read first. */
export const CHANGE_MARK_SHARE = 0.7

/** A focus ring around a trip mark, as multiples of the mark's radius: just outside its background halo (1.2). */
export const FOCUS_OUTSIDE_INNER = 1.25
export const FOCUS_OUTSIDE_OUTER = 1.45

/** A mark's radius for its role. */
export function markRadius(role: TripMarkRole, base: number): number {
  return role === 'change' ? base * CHANGE_MARK_SHARE : base
}

/**
 * The start mark's radius with the location reticle on it: when the fix lies within the mark, the mark grows so its
 * ring ends `gapM` outside the reticle's outer radius (`reticleOuterM`), so the reticle drawn over it can't hide it.
 * Otherwise, or with no fix, `radius` unchanged.
 */
export function startRadiusNearFix(radius: number, pos: Ground, fix: Ground | null, reticleOuterM: number, gapM: number): number {
  if (!fix || Math.hypot(fix.x - pos.x, fix.z - pos.z) > radius) return radius
  return Math.max(radius, reticleOuterM + gapM)
}
