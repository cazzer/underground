import type { StationStreets, StreetWay } from '../data/streetSchema'
import type { LineBuffers, Rgb } from './lineBuffers'
import { isClosedRing, isStreet } from './streetClass'

/** The file's coordinates are integer decimeters. */
const DM_PER_M = 10

/** Over this last stretch of the file's `radiusM` the streets mix to the background, so the clip has no hard edge. */
export const STREET_EDGE_FADE_M = 70

/** 0 inside the ramp, 1 at the radius and beyond, linear between: how far a point at `r` meters mixes to `fadeTo`. */
export function edgeFade(r: number, radiusM: number, fadeM = STREET_EDGE_FADE_M): number {
  const start = Math.max(radiusM - fadeM, 0)
  if (r <= start) return 0
  if (r >= radiusM) return 1
  return (r - start) / (radiusM - start)
}

/** Parameters t in (0, 1) where the segment a→b crosses the circle of radius `r` about the origin. */
function circleCrossings(ax: number, az: number, bx: number, bz: number, r: number, out: number[]): void {
  const dx = bx - ax
  const dz = bz - az
  const a = dx * dx + dz * dz
  if (a === 0 || r <= 0) return
  const b = 2 * (ax * dx + az * dz)
  const c = ax * ax + az * az - r * r
  const disc = b * b - 4 * a * c
  if (disc <= 0) return
  const s = Math.sqrt(disc)
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) if (t > 0 && t < 1) out.push(t)
}

/**
 * The file's streets (`isStreet`: named roadways, no plazas) as line segments in meters from its anchor, at y = 0,
 * colored `rgb` (linear) and mixed toward `fadeTo` (the background, linear) over the last `fadeM` of `radiusM`
 * (`edgeFade`). A segment crossing the ramp's start or end is split there, so the gradient runs between real
 * vertices. Footways, steps and unnamed ways are left out. Throws on a node index outside the node table.
 */
export function streetBuffers(file: StationStreets, rgb: Rgb, fadeTo: Rgb, fadeM = STREET_EDGE_FADE_M): LineBuffers {
  const ways: StreetWay[] = file.ways.filter((w) => isStreet(w, isClosedRing(w.nodes)))
  const nodes = file.x.length
  const rings = [Math.max(file.radiusM - fadeM, 0), file.radiusM]
  const positions: number[] = []
  const colors: number[] = []
  const point = (way: StreetWay, i: number): [number, number] => {
    const n = way.nodes[i]!
    if (!Number.isInteger(n) || n < 0 || n >= nodes) {
      throw new Error(`Street way ${way.id} of station ${file.stationId}: node index ${n} outside its ${nodes} nodes`)
    }
    return [file.x[n]! / DM_PER_M, file.z[n]! / DM_PER_M]
  }
  const vertex = (x: number, z: number) => {
    const w = edgeFade(Math.hypot(x, z), file.radiusM, fadeM)
    positions.push(x, 0, z)
    for (let k = 0; k < 3; k++) colors.push(rgb[k]! + (fadeTo[k]! - rgb[k]!) * w)
  }
  const ts: number[] = []
  for (const way of ways) {
    for (let i = 1; i < way.nodes.length; i++) {
      const [ax, az] = point(way, i - 1)
      const [bx, bz] = point(way, i)
      ts.length = 0
      for (const r of rings) circleCrossings(ax, az, bx, bz, r, ts)
      ts.sort((p, q) => p - q).push(1)
      let px = ax
      let pz = az
      for (const t of ts) {
        const x = ax + (bx - ax) * t
        const z = az + (bz - az) * t
        vertex(px, pz)
        vertex(x, z)
        px = x
        pz = z
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}
