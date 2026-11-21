/**
 * Shifts a shape sideways so each travel direction draws as its own track. Pure.
 * Type-only `.ts` import because scripts/lib/trackAlignment.test.ts loads this file.
 */
import type { Ground } from './projection.ts'

/** Sharp bends cap the miter at this multiple of the offset, so hairpins don't spike. */
export const MITER_LIMIT = 2

/**
 * TEMPORARY `?tracks=` choices (removal list in src/data/trackLook.ts). `a` is the measured
 * half-spacing at Bedford Av (L08 tracks sit 4.70 m either side of the platform axis).
 */
export const TRACK_OFFSETS = { a: 4.7, b: 3, off: 0 } as const

export function resolveTrackOffset(search: string): number {
  const name = new URLSearchParams(search).get('tracks')
  return name === 'b' || name === 'off' ? TRACK_OFFSETS[name] : TRACK_OFFSETS.a
}

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

/**
 * Offsets `points` by `offsetM` meters, positive to the right of travel. Interior vertices use miter
 * joins, capped at MITER_LIMIT × offset (a full reversal too). The result has
 * the same point count as the input. Fewer than two distinct points, or offset 0, returns a copy.
 */
export function offsetPolyline(points: readonly Ground[], offsetM: number): Ground[] {
  const copy = () => points.map((p) => ({ x: p.x, z: p.z }))
  if (offsetM === 0 || points.length < 2) return copy()
  const normals = fillGaps(segmentNormals(points))
  if (!normals) return copy()

  const last = normals.length - 1
  return points.map((p, i) => {
    const a = normals[Math.max(i - 1, 0)]!
    const b = normals[Math.min(i, last)]!
    const sx = a.x + b.x
    const sz = a.z + b.z
    const sumLen = Math.hypot(sx, sz)
    if (sumLen < 1e-6) {
      // An exact reversal has no bisector: put the tip on the miter cap along the incoming
      // tangent (a.z, -a.x), as a near-reversal would be.
      const len = offsetM * MITER_LIMIT
      return { x: p.x + a.z * len, z: p.z - a.x * len }
    }
    const mx = sx / sumLen
    const mz = sz / sumLen
    // cos of the half-angle between the two normals; the miter is offset / cos, capped.
    const cosHalf = mx * a.x + mz * a.z
    const len = offsetM / Math.max(cosHalf, 1 / MITER_LIMIT)
    return { x: p.x + mx * len, z: p.z + mz * len }
  })
}
