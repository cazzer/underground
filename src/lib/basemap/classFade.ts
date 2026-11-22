/**
 * How strongly each basemap class draws at a camera distance: 1 at `full` and closer, `floor` at `gone` and beyond,
 * smoothstep in log distance between (as the interior reveal eases, interiorReveal.ts). The city view keeps water at
 * 0.6 (so the marsh and shore outlines of New Jersey and Long Island don't outweigh the subway), parks and highways at
 * half; the street grid comes in as the camera nears a neighbourhood, and footpaths
 * only once the view is about to tip (the tilt's top-down distance). A class at 0 is not drawn.
 */
import { DOTS_FROM_M } from '../live/consist'
import { DEFAULT_TILT } from '../tilt'
import type { BasemapClass } from './featureClass'

export interface ClassFade {
  /** At or inside this camera distance (meters) the class draws at full strength. */
  full: number
  /** At or beyond this distance it draws at `floor`. */
  gone: number
  /** 0..1: its strength far out. */
  floor: number
}

export const CLASS_FADE: Readonly<Record<BasemapClass, ClassFade>> = {
  water: { full: 10_000, gone: 20_000, floor: 0.6 },
  park: { full: 20_000, gone: 60_000, floor: 0.5 },
  highway: { full: 20_000, gone: 60_000, floor: 0.5 },
  major: { full: 10_000, gone: 25_000, floor: 0 },
  minor: { full: 4_000, gone: 8_000, floor: 0 },
  // Paths start in as the trains unfold into cars and are in by the time the view starts to tip.
  path: { full: DEFAULT_TILT.farDistance, gone: DOTS_FROM_M, floor: 0 },
}

const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** The class's strength (0..1) at camera distance `distance`, per CLASS_FADE. */
export function classVisibility(cls: BasemapClass, distance: number): number {
  const { full, gone, floor } = CLASS_FADE[cls]
  if (distance <= full) return 1
  if (distance >= gone) return floor
  const t = Math.log(distance / full) / Math.log(gone / full)
  return 1 - (1 - floor) * smoothstep(t)
}
