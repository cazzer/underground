/**
 * A shape's drawn track: decode, project, drop out-and-back spurs, offset right of travel. Pure.
 * The map lines use it now; realtime stop distances (pah.3) will use it so dots ride the same line.
 * Explicit `.ts` imports because scripts/lib/trackAlignment.test.ts loads this file in Node.
 */
import { decodeShapePoints } from '../data/codec.ts'
import type { Shape } from '../data/schema.ts'
import { toGround, type Ground } from './projection.ts'
import { offsetPolyline } from './trackOffset.ts'

/** Index of the nearest point before/after `i` that differs from points[i], or -1. */
function distinctNeighbor(points: readonly Ground[], i: number, step: 1 | -1): number {
  const p = points[i]!
  for (let j = i + step; j >= 0 && j < points.length; j += step) {
    const q = points[j]!
    if (q.x !== p.x || q.z !== p.z) return j
  }
  return -1
}

/**
 * Removes the tip vertex of every turn of at least `minTurnDeg` (an out-and-back spur, which an
 * offset would draw as a thin loop or an X), repeating until none is left. Endpoints are kept.
 * 160 rather than 170: the R..N78R spur tip near Canal St turns 166.9°, and once the spurs are gone
 * no vertex in the fall 2026 shapes turns more than 136°.
 */
export function dropSpurs(points: readonly Ground[], minTurnDeg = 160): Ground[] {
  const out = [...points]
  const cosLimit = Math.cos((minTurnDeg * Math.PI) / 180)
  let removed = true
  while (removed) {
    removed = false
    for (let i = 1; i < out.length - 1; i++) {
      const before = distinctNeighbor(out, i, -1)
      const after = distinctNeighbor(out, i, 1)
      if (before < 0 || after < 0) continue
      const p = out[i]!
      const inX = p.x - out[before]!.x
      const inZ = p.z - out[before]!.z
      const outX = out[after]!.x - p.x
      const outZ = out[after]!.z - p.z
      const cosTurn = (inX * outX + inZ * outZ) / (Math.hypot(inX, inZ) * Math.hypot(outX, outZ))
      if (cosTurn <= cosLimit) {
        out.splice(i, 1)
        removed = true
        i--
      }
    }
  }
  return out
}

/** The polyline a shape draws as: its centerline without spurs, `offsetM` right of travel. */
export function trackLine(shape: Pick<Shape, 'lat' | 'lon'>, offsetM: number): Ground[] {
  return offsetPolyline(dropSpurs(decodeShapePoints(shape).map((p) => toGround(p))), offsetM)
}
