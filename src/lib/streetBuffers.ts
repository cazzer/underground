import type { StationStreets, StreetWay } from '../data/streetSchema'
import type { LineBuffers, Rgb } from './lineBuffers'
import { isClosedRing, isStreet } from './streetClass'

/** The file's coordinates are integer decimeters. */
const DM_PER_M = 10

/**
 * The file's streets (`isStreet`: named roadways, no plazas) as line segments in meters from its anchor, at y = 0,
 * every vertex colored `rgb` (linear). Footways, steps and unnamed ways are left out. Throws on a node index outside
 * the node table.
 */
export function streetBuffers(file: StationStreets, rgb: Rgb): LineBuffers {
  const ways: StreetWay[] = file.ways.filter((w) => isStreet(w, isClosedRing(w.nodes)))
  let count = 0
  for (const w of ways) count += Math.max(w.nodes.length - 1, 0)
  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 6)
  const nodes = file.x.length
  const at = (way: StreetWay, i: number, out: number) => {
    const n = way.nodes[i]!
    if (!Number.isInteger(n) || n < 0 || n >= nodes) {
      throw new Error(`Street way ${way.id} of station ${file.stationId}: node index ${n} outside its ${nodes} nodes`)
    }
    positions[out] = file.x[n]! / DM_PER_M
    positions[out + 1] = 0
    positions[out + 2] = file.z[n]! / DM_PER_M
    colors[out] = rgb[0]
    colors[out + 1] = rgb[1]
    colors[out + 2] = rgb[2]
  }
  let o = 0
  for (const w of ways) {
    for (let i = 1; i < w.nodes.length; i++) {
      at(w, i - 1, o)
      at(w, i, o + 3)
      o += 6
    }
  }
  return { positions, colors }
}
