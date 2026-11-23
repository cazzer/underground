/**
 * Which part of the overlap of several station street layers each one draws (o3r.5), so a street two 300 m files
 * both hold draws once and no faded edge of one paints over the full colour of another. Each layer keeps its power
 * diagram cell: a point p is layer i's when |p - a_i|^2 - R_i^2 is the least over the layers whose discs overlap i's
 * (a_i its anchor, R_i its radius). A point inside the union of discs always lies inside its owner's disc, and with
 * equal radii the owner is the nearest anchor, the disc whose edge fade (streetBuffers.ts) is least there and whose
 * mask the basemap's roads follow (streetMask.ts keeps the least road alpha), so the streets and roads still
 * cross-fade without a gap. Pure.
 */
import type { LineBuffers } from './lineBuffers'

/** One drawn street layer: its anchor (scene ground meters) and its file's radius. */
export interface StreetSite {
  id: string
  x: number
  z: number
  radiusM: number
}

/**
 * The half-planes bounding a layer's cell, in its own local meters (east, south from its anchor): the layer owns
 * (x, z) when nx * x + nz * z <= c for every plane. `key` names the overlapping layers that cut it (sorted; a '!'
 * prefix for a coincident one ranked earlier), so the planes change only when it does.
 */
export interface StreetCell {
  key: string
  /** nx, nz, c per plane. */
  planes: Float64Array
}

/** No neighbour overlaps: the layer draws whole. */
export const NO_CELL: StreetCell = Object.freeze({ key: '', planes: new Float64Array(0) })

/** Anchors closer than this are one point: the earlier-ranked layer takes it all. */
const COINCIDENT_M = 1e-3
/** Pieces shorter than this after a cut are dropped. */
const MIN_PIECE_M = 1e-3

/**
 * Each site's cell against the others, in the same order. Rank is the order (the focused layer first): it only
 * matters for coincident anchors, where the later one gets an empty cell.
 */
export function streetCells(sites: readonly StreetSite[]): readonly StreetCell[] {
  return sites.map((s, i) => {
    const planes: number[] = []
    const keys: string[] = []
    sites.forEach((o, j) => {
      if (j === i) return
      const ox = o.x - s.x
      const oz = o.z - s.z
      const d = Math.hypot(ox, oz)
      if (d >= s.radiusM + o.radiusM) return
      if (d < COINCIDENT_M) {
        if (j > i) return
        // Never true: the earlier-ranked layer owns every point.
        planes.push(0, 0, -1)
        keys.push(`!${o.id}`)
        return
      }
      planes.push(2 * ox, 2 * oz, d * d + s.radiusM * s.radiusM - o.radiusM * o.radiusM)
      keys.push(o.id)
    })
    return planes.length === 0 ? NO_CELL : { key: keys.sort().join(','), planes: Float64Array.from(planes) }
  })
}

/** Whether local (x, z) lies in the cell (on a boundary counts). */
export function inCell(cell: StreetCell, x: number, z: number): boolean {
  const p = cell.planes
  for (let k = 0; k < p.length; k += 3) if (p[k]! * x + p[k + 1]! * z > p[k + 2]!) return false
  return true
}

/**
 * A plain line layer's buffers with only what lies in the cell kept: each segment cut to the cell (convex, so one
 * interval per segment), positions and colors interpolated at the cuts, so the edge fade carries on across them.
 * The same object when the cell has no planes.
 */
export function clipToCell(buffers: LineBuffers, cell: StreetCell): LineBuffers {
  const planes = cell.planes
  if (planes.length === 0) return buffers
  const { positions: p, colors: c } = buffers
  const positions: number[] = []
  const colors: number[] = []
  const lerp = (from: Float32Array, i: number, t: number, out: number[]) => {
    for (let k = 0; k < 3; k++) out.push(from[i + k]! + (from[i + 3 + k]! - from[i + k]!) * t)
  }
  for (let i = 0; i + 6 <= p.length; i += 6) {
    const ax = p[i]!
    const az = p[i + 2]!
    const dx = p[i + 3]! - ax
    const dz = p[i + 5]! - az
    let t0 = 0
    let t1 = 1
    for (let k = 0; k < planes.length && t0 < t1; k += 3) {
      const nx = planes[k]!
      const nz = planes[k + 1]!
      const slope = nx * dx + nz * dz
      const start = nx * ax + nz * az - planes[k + 2]!
      if (slope === 0) {
        if (start > 0) t1 = -1
        continue
      }
      const t = -start / slope
      if (slope > 0) t1 = Math.min(t1, t)
      else t0 = Math.max(t0, t)
    }
    if (t0 >= t1 || (t1 - t0) * Math.hypot(dx, dz) < MIN_PIECE_M) continue
    for (const t of [t0, t1]) {
      lerp(p, i, t, positions)
      lerp(c, i, t, colors)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}
