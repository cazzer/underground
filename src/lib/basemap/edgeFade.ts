/**
 * Where the basemap ends, as two alpha factors on every class (multiplied):
 * - `networkAlpha`: 1 within NETWORK_PAD_M of the network's outline (the stations' convex hull, networkHull.ts), easing
 *   to 0 over NETWORK_FADE_M more, so the basemap thins out away from the subway instead of ending in a frame. (The
 *   network's bounding box would not do: it lies 0.6 to 4.6 km inside the bbox on every side, so padded it is the bbox.)
 * - `edgeAlpha`: a hard stop at the spec bbox (the tile set is cut square there), easing in over `edgeFadeFor(distance)`:
 *   3 km at the city view, down to 100 m close in, so a station near the bbox edge (Tottenville, Wakefield) keeps its
 *   streets at station zoom.
 * Each is the TS twin of its GLSL in src/scene/basemapLineMaterial.ts (NETWORK_GLSL, EDGE_GLSL); change both together.
 */
import { groundX, groundZ } from '../projection'
import { hullOutside, type HullEdge } from './networkHull'

/** The bbox edge fade's width: EDGE_FADE_PER_M of the camera distance, clamped to [EDGE_FADE_MIN_M, EDGE_FADE_MAX_M]. */
export const EDGE_FADE_PER_M = 0.04
export const EDGE_FADE_MIN_M = 100
export const EDGE_FADE_MAX_M = 3000
/** The basemap draws in full this far outside the network's outline, then fades out over NETWORK_FADE_M. */
export const NETWORK_PAD_M = 5000
export const NETWORK_FADE_M = 7000

/** A box in scene meters: x east, z south. */
export interface SceneBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** A [west, south, east, north] lon/lat bbox in scene meters. */
export function sceneBox([west, south, east, north]: readonly [number, number, number, number]): SceneBox {
  return { minX: groundX(west), maxX: groundX(east), minZ: groundZ(north), maxZ: groundZ(south) }
}

const smoothstep = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1)
  return c * c * (3 - 2 * c)
}

/** The bbox edge fade's width at camera distance `distance`. */
export function edgeFadeFor(distance: number): number {
  return Math.min(Math.max(EDGE_FADE_PER_M * distance, EDGE_FADE_MIN_M), EDGE_FADE_MAX_M)
}

/** The alpha a basemap stroke keeps at scene (x, z): 0 at and outside the bbox edge, 1 from `fadeM` inside, smoothstep between. */
export function edgeAlpha(x: number, z: number, box: SceneBox, fadeM: number): number {
  return smoothstep(Math.min(x - box.minX, box.maxX - x, z - box.minZ, box.maxZ - z) / fadeM)
}

/** The alpha a basemap stroke keeps at scene (x, z): 1 within `padM` of the network's outline, 0 from `fadeM` beyond that, smoothstep between. */
export function networkAlpha(x: number, z: number, edges: readonly HullEdge[], padM = NETWORK_PAD_M, fadeM = NETWORK_FADE_M): number {
  return 1 - smoothstep((hullOutside(x, z, edges) - padM) / fadeM)
}
