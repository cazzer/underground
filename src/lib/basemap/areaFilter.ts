/**
 * Small park and water rings are noise far out: the city view should be carried by Central Park, Prospect Park,
 * Flushing Meadows and the shore, not by every pocket park. A ring under an area step's size is drawn only from that
 * step's tile zoom in. The tile zoom stands for the camera distance (basemapTiles.ts picks
 * round(log2(94,060 × viewport height px / distance)), so on an 844 px phone z14 serves about 3.4 to 6.9 km, z13 6.9
 * to 13.7 km, z12 13.7 to 27 km; a 900 px desktop about 7% farther):
 * - under 1 ha from z14: drawn within about 7 km, the minor roads' range (classFade.ts, gone by 8 km)
 * - under 5 ha from z13: drawn within about 14 km (15 km on a desktop), short of the 20 km where water and parks
 *   settle at their city-view strength (z12 would keep them to 27 km)
 * A ring that reaches the tile edge is part of something cut by the tiler, so its area here says nothing: it stays.
 */

export interface AreaStep {
  /** Rings smaller than this (m²)... */
  belowM2: number
  /** ...are drawn only in tiles of this zoom or finer. */
  fromZ: number
}

export const AREA_STEPS: readonly AreaStep[] = [
  { belowM2: 10_000, fromZ: 14 },
  { belowM2: 50_000, fromZ: 13 },
]

/** Whether a ring of `areaM2` (absolute) is drawn in a tile of zoom `z`; one that touches the tile edge always is. */
export function keepRing(areaM2: number, z: number, touchesTileEdge: boolean): boolean {
  if (touchesTileEdge) return true
  for (const step of AREA_STEPS) if (areaM2 < step.belowM2 && z < step.fromZ) return false
  return true
}

/** Absolute shoelace area of a closed ring given as flat [x0, z0, x1, z1, ...] (the last point may repeat the first). */
export function ringArea(xz: readonly number[]): number {
  let twice = 0
  const n = xz.length / 2
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    twice += xz[i * 2]! * xz[j * 2 + 1]! - xz[j * 2]! * xz[i * 2 + 1]!
  }
  return Math.abs(twice) / 2
}
