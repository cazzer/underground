import { Color } from 'three'
import type { LineBuffers } from '../lib/lineBuffers'

/**
 * The searched place's pin, in units of its radius (1): a diamond outline with a centre dot, inside a thin
 * background-colored halo band round the outline (not a disc: the station, lines and trains under the pin's middle stay
 * visible). A diamond reads apart from the location reticle (a ring with ticks) and the focus ring (a plain circle)
 * without color alone.
 */
export const HALO_INNER = 0.7
export const HALO_OUTER = 1.4
export const DOT_RADIUS = 0.3

/** The diamond's four corners on the ground plane, east, south, west, north of the center. */
const CORNERS: readonly (readonly [number, number])[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
]

/** The diamond's four edges as line segments; one color for every vertex (`hex` is sRGB, vertex colors linear). */
export function pinOutlineBuffers(hex: string): LineBuffers {
  const positions: number[] = []
  CORNERS.forEach(([ax, az], i) => {
    const [bx, bz] = CORNERS[(i + 1) % CORNERS.length]!
    positions.push(ax, 0, az, bx, 0, bz)
  })
  const c = new Color(hex)
  const colors = new Float32Array(positions.length)
  for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i)
  return { positions: new Float32Array(positions), colors }
}
