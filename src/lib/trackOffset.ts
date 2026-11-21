/**
 * Shifts a shape sideways so each travel direction draws as its own track. Pure.
 * Type-only `.ts` import because scripts/lib/trackAlignment.test.ts loads this file.
 */
import type { Ground } from './projection.ts'

/** Sharp bends cap the miter at this multiple of the offset, so hairpins don't spike. */
export const MITER_LIMIT = 2

/** How far each shape's track sits right of its travel direction: the measured half-spacing at Bedford Av (L08 tracks sit 4.70 m either side of the platform axis). */
export const TRACK_OFFSET_M = 4.7

const EPS = 1e-9

/** Right normal of each segment (scene tangent (tx, tz) → (-tz, tx)); null for zero-length ones. */
function segmentNormals(points: readonly Ground[]): (Ground | null)[] {
  const normals: (Ground | null)[] = []
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x
    const dz = points[i]!.z - points[i - 1]!.z
    const len = Math.hypot(dx, dz)
    normals.push(len < EPS ? null : { x: -dz / len, z: dx / len })
  }
  return normals
}

/** Zero-length segments borrow the normal of the nearest real segment (ties go to the earlier one). */
function fillGaps(normals: readonly (Ground | null)[]): Ground[] | null {
  if (normals.every((n) => n === null)) return null
  return normals.map((n, i) => {
    if (n) return n
    for (let step = 1; ; step++) {
      const before = normals[i - step]
      if (before) return before
      const after = normals[i + step]
      if (after) return after
    }
  })
}

/** A vertex's join: unit direction (x, z) and the divisor `cosHalf`, so a shift of `d` lands at d / cosHalf along it. */
export interface Miter {
  x: number
  z: number
  /** cos of the half-angle between the two segment normals, floored at 1 / MITER_LIMIT. */
  cosHalf: number
}

/**
 * The miter join at each point, positive to the right of travel: the bisector of the two segment normals,
 * capped at MITER_LIMIT (a full reversal puts it along the incoming tangent at the cap). One per point; null
 * for fewer than two distinct points. offsetPolyline uses it, and so does the band offset (bandOffset.ts),
 * which shifts the drawn line sideways by a screen-pixel amount along the same joins.
 */
export function miterNormals(points: readonly Ground[]): Miter[] | null {
  if (points.length < 2) return null
  const normals = fillGaps(segmentNormals(points))
  if (!normals) return null
  const last = normals.length - 1
  return points.map((_, i) => {
    const a = normals[Math.max(i - 1, 0)]!
    const b = normals[Math.min(i, last)]!
    const sx = a.x + b.x
    const sz = a.z + b.z
    const sumLen = Math.hypot(sx, sz)
    // An exact reversal has no bisector: the tip goes on the miter cap along the incoming tangent (a.z, -a.x),
    // as a near-reversal turning away from the offset side would.
    if (sumLen < 1e-6) return { x: a.z, z: -a.x, cosHalf: 1 / MITER_LIMIT }
    const x = sx / sumLen
    const z = sz / sumLen
    return { x, z, cosHalf: Math.max(x * a.x + z * a.z, 1 / MITER_LIMIT) }
  })
}

/**
 * Offsets `points` by `offsetM` meters, positive to the right of travel. Interior vertices use miter
 * joins, capped at MITER_LIMIT × offset (a full reversal too). The result has
 * the same point count as the input. Fewer than two distinct points, or offset 0, returns a copy.
 */
export function offsetPolyline(points: readonly Ground[], offsetM: number): Ground[] {
  const miters = offsetM === 0 ? null : miterNormals(points)
  if (!miters) return points.map((p) => ({ x: p.x, z: p.z }))
  return points.map((p, i) => {
    const m = miters[i]!
    const len = offsetM / m.cosHalf
    return { x: p.x + m.x * len, z: p.z + m.z * len }
  })
}
