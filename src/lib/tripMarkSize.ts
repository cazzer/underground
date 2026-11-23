/**
 * Sizes of the trip's station marks (TripMarks.tsx) and of a focus ring around one (FocusRing.tsx). Pure, allocation-free:
 * all world meters, from the mark's base radius (screenScale of tripMarkRadiusPx) at the current camera distance.
 */
import type { Ground } from './projection'
import type { TripMarkRole } from './tripMarks'

/** A change mark's radius as a share of a start or end mark's: the journey's ends read first. */
export const CHANGE_MARK_SHARE = 0.7

/** A start mark grown round the location reticle is never more than this many times its own radius. */
export const START_GROWTH_CAP = 2.5

/** A focus ring around a trip mark, as multiples of the mark's radius: just outside its background halo (1.2). */
export const FOCUS_OUTSIDE_INNER = 1.25
export const FOCUS_OUTSIDE_OUTER = 1.45

/** The location reticle as a start mark must clear it: its outer radius and the gap to keep outside it, meters. */
export interface ReticleClearance {
  outerM: number
  gapM: number
}

/**
 * The start mark's radius with the location reticle near it. While the reticle overlaps the mark (the fix within
 * `radius` + its outer radius) the mark grows so its ring ends `gapM` outside the reticle's far edge (the fix's offset +
 * its outer radius), at most START_GROWTH_CAP times `radius`. The growth eases in over the reticle's outer radius of
 * offset, from none where it just touches the ring to all of it once the fix is on the mark, so a fix sliding in
 * doesn't pop. With no fix, or the reticle clear of the mark, `radius` unchanged.
 */
export function startRadiusNearFix(radius: number, pos: Ground, fix: Ground | null, reticle: ReticleClearance): number {
  if (!fix) return radius
  const offset = Math.hypot(fix.x - pos.x, fix.z - pos.z)
  const reach = radius + reticle.outerM
  if (offset >= reach) return radius
  const grown = Math.min(Math.max(radius, offset + reticle.outerM + reticle.gapM), radius * START_GROWTH_CAP)
  const t = reticle.outerM > 0 ? Math.min((reach - offset) / reticle.outerM, 1) : 1
  return radius + (grown - radius) * t
}

/** A mark's drawn radius: a change at CHANGE_MARK_SHARE of `base`, a start grown round the reticle (startRadiusNearFix). */
export function tripMarkRadius(role: TripMarkRole, base: number, pos: Ground, fix: Ground | null, reticle: ReticleClearance): number {
  if (role === 'change') return base * CHANGE_MARK_SHARE
  return role === 'start' ? startRadiusNearFix(base, pos, fix, reticle) : base
}
