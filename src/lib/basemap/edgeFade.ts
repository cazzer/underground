/**
 * The basemap's data stops at the spec bbox (the tiles that touch it, cut square at their edges), so every class
 * fades out over the last EDGE_FADE_M inside the bbox and is gone at its edge: no hard tile edge shows at the city view.
 * `edgeAlpha` is the TS twin of EDGE_GLSL in src/scene/basemapLineMaterial.ts; change both together.
 */
import { groundX, groundZ } from '../projection'

/** How far inside the bbox edge the basemap is fully drawn, meters. */
export const EDGE_FADE_M = 3000

/** The bbox in scene meters: x east, z south. */
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

/** The alpha a basemap stroke keeps at scene (x, z): 0 at and outside the bbox edge, 1 from `fadeM` inside, smoothstep between. */
export function edgeAlpha(x: number, z: number, box: SceneBox, fadeM = EDGE_FADE_M): number {
  const d = Math.min(x - box.minX, box.maxX - x, z - box.minZ, box.maxZ - z)
  const t = Math.min(Math.max(d / fadeM, 0), 1)
  return t * t * (3 - 2 * t)
}
