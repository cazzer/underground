/**
 * Where one line runs on another's track: the stretches of a variant shape's track line that lie on its primary's,
 * as pairs of distances along each. corridorShare.ts gives the variant the primary's bands there. Pure.
 */
import { buildSegmentGrid, cellIndex, type SegmentGrid } from './corridorHash'
import type { Polyline } from './realtime/polyline'

/**
 * A vertex this close to the other line is on its track: variantCover.ts's COVER_POINT_M, since only where the cover
 * can then skip the variant is sharing worth a change. Shared GTFS points match to well under it; the stretches with
 * points 4-5 cm apart keep their own bands (sharing there skips nothing).
 */
export const SHARE_M = 1e-3
/**
 * Distance along the primary minus distance along the variant may drift this much between two vertices of one run;
 * a bigger jump is another pass over the same place (a loop) and ends the run.
 */
const OFFSET_SLACK_M = 0.01
/** Cell size of a grid built for one line alone (corridors.ts passes its own, of every shape). */
const CELL_M = 100

/** A shared stretch: variant distance v[i] is primary distance p[i], both increasing, at least two pairs. */
export interface SharedRun {
  v: Float64Array
  p: Float64Array
}

/** A primary's track: its line, and a segment grid (reach at least SHARE_M) in which it is line `owner`. */
export interface TrackIndex {
  line: Polyline
  grid: SegmentGrid
  owner: number
}

/** A grid of `line` alone. */
export function indexTrack(line: Polyline): TrackIndex {
  return { line, grid: buildSegmentGrid([line.points], [0], SHARE_M, CELL_M), owner: 0 }
}

/**
 * The distance along the indexed line of a point of it within SHARE_M of (x, z): the one nearest `want` along the
 * line, or with `want` NaN the nearest on the ground. NaN when there is none.
 */
function onTrack(index: TrackIndex, x: number, z: number, want: number): number {
  if (!Number.isNaN(want)) {
    const near = nearWant(index.line, x, z, want)
    if (!Number.isNaN(near)) return near
  }
  const { grid, owner } = index
  const c = cellIndex(grid, x, z)
  let best = NaN
  let bestKey = Infinity
  if (c < 0) return best
  for (let j = grid.start[c]!, end = grid.start[c + 1]!; j < end; ) {
    const s = grid.items[j]!
    if (grid.owner[s] !== owner) {
      j = grid.lineEnd[j]!
      continue
    }
    j++
    const px = x - grid.ax[s]!
    const pz = z - grid.az[s]!
    const t = Math.min(Math.max(px * grid.ux[s]! + pz * grid.uz[s]!, 0), grid.len[s]!)
    const off = Math.hypot(px - grid.ux[s]! * t, pz - grid.uz[s]! * t)
    if (off > SHARE_M) continue
    // startD sums the same lengths in the same order as the line's cumulative, so it is that exact distance.
    const d = grid.startD[s]! + t
    const key = Number.isNaN(want) ? off : Math.abs(d - want)
    if (key < bestKey || (key === bestKey && d < best)) {
      best = d
      bestKey = key
    }
  }
  return best
}

/** The fast path along a run: the line's segments on either side of distance `want`. */
function nearWant(line: Polyline, x: number, z: number, want: number): number {
  const k = vertexAt(line, want)
  let best = NaN
  let bestKey = Infinity
  for (let s = Math.max(k - 1, 0); s <= k && s + 1 < line.points.length; s++) {
    const a = line.points[s]!
    const b = line.points[s + 1]!
    const len = line.cumulative[s + 1]! - line.cumulative[s]!
    if (len === 0) continue
    const ux = (b.x - a.x) / len
    const uz = (b.z - a.z) / len
    const t = Math.min(Math.max((x - a.x) * ux + (z - a.z) * uz, 0), len)
    if (Math.hypot(x - a.x - ux * t, z - a.z - uz * t) > SHARE_M) continue
    const d = line.cumulative[s]! + t
    if (Math.abs(d - want) < bestKey) {
      best = d
      bestKey = Math.abs(d - want)
    }
  }
  return best
}

/** Largest vertex index k with cumulative[k] <= d. */
function vertexAt(line: Polyline, d: number): number {
  let lo = 0
  let hi = line.points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (line.cumulative[mid]! <= d) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Ground distance from point k of `line` to the segment a..b. */
function offSegment(line: Polyline, k: number, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const p = line.points[k]!
  const dx = b.x - a.x
  const dz = b.z - a.z
  const l2 = dx * dx + dz * dz
  const t = l2 === 0 ? 0 : Math.min(Math.max(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0), 1)
  return Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t)
}

/** Whether every primary vertex strictly between distances p0 and p1 lies on the variant's segment a..b. */
function between(index: TrackIndex, p0: number, p1: number, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const { line } = index
  for (let k = vertexAt(line, p0) + 1; k < line.points.length && line.cumulative[k]! < p1; k++) {
    if (line.cumulative[k]! > p0 && offSegment(line, k, a, b) > SHARE_M) return false
  }
  return true
}

/**
 * The runs of `variant` on the indexed primary's track: consecutive variant vertices each within SHARE_M of the
 * primary, the primary's vertices between them within SHARE_M of the variant, so the two are one track there (within
 * SHARE_M both ways), moving forward along both together.
 */
export function sharedRuns(variant: Polyline, primary: TrackIndex): SharedRun[] {
  const runs: SharedRun[] = []
  let v: number[] = []
  let p: number[] = []
  const close = () => {
    if (v.length >= 2) runs.push({ v: Float64Array.from(v), p: Float64Array.from(p) })
    v = []
    p = []
  }
  variant.points.forEach((pt, i) => {
    const dv = variant.cumulative[i]!
    if (v.length > 0) {
      const want = dv + p.at(-1)! - v.at(-1)!
      const next = onTrack(primary, pt.x, pt.z, want)
      if (Math.abs(next - want) <= OFFSET_SLACK_M && next >= p.at(-1)! && between(primary, p.at(-1)!, next, variant.points[i - 1]!, pt)) {
        v.push(dv)
        p.push(next)
        return
      }
      close()
    }
    const start = onTrack(primary, pt.x, pt.z, NaN)
    if (!Number.isNaN(start)) {
      v.push(dv)
      p.push(start)
    }
  })
  close()
  return runs
}
