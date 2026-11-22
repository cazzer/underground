/**
 * Where the focused station's own street layer (StationStreets.tsx) draws, so the basemap's roads step aside there:
 * written by that layer while it is mounted, read each frame by the basemap. Inside the layer's radius the roads fade
 * out as the station's streets fade in, over the exact complement of the layer's edge fade (streetBuffers.ts), so
 * the two cross-fade with no gap ring and no doubled stroke.
 */
import { STREET_EDGE_FADE_M } from '../streetBuffers'

export interface StreetMask {
  /** A station street layer is mounted. */
  present: boolean
  /** Its anchor, scene meters. */
  x: number
  z: number
  /** Its file's radius: past it the station layer draws nothing. */
  radiusM: number
}

export function createStreetMask(): StreetMask {
  return { present: false, x: 0, z: 0, radiusM: 0 }
}

/** Where the mask's ramp starts: the station layer's edge fade start. The ramp ends at the radius. */
export function maskInner(radiusM: number): number {
  return Math.max(radiusM - STREET_EDGE_FADE_M, 0)
}

/**
 * TS twin of the basemap road shader's mask (MASK_GLSL in basemapLineMaterial.ts): the alpha a road keeps at `r`
 * meters from the mask's center, with the station layer drawn at `strength` (its opacity). Change both together.
 */
export function maskAlpha(r: number, inner: number, outer: number, strength: number): number {
  const ramp = Math.min(Math.max((r - inner) / Math.max(outer - inner, 1e-3), 0), 1)
  return 1 - strength * (1 - ramp)
}
