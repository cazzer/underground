/**
 * Which other routes run beside a line, sample by sample, from the segment grid (corridorHash.ts). Pure.
 */
import { cellIndex, segmentDistance, type SegmentGrid } from './corridorHash'
import type { Polyline } from './realtime/polyline'

export interface NeighbourSearch {
  grid: SegmentGrid
  reachM: number
  /** cos of the largest heading difference that still counts as running alongside. */
  cosMax: number
  sampleM: number
}

/** A line's samples: distance, and the groups beside it. */
export interface LineSamples {
  dist: Float64Array
  /** Bit g (1 << g) set: a line of group g runs beside this sample. */
  masks: Int32Array
  /** The earlier line on the same track this sample was copied from, or -1 when it was searched. */
  source: Int32Array
  /** The sample of `source` it copied. */
  sourceAt: Int32Array
}

/** A point along a line and its unit heading, rewritten per sample (no allocation per sample). */
export interface Probe {
  x: number
  z: number
  hx: number
  hz: number
}

/**
 * Calls `visit(i, d, probe)` at every `stepM` along the line and at its end (n = floor(length / stepM) + 2
 * samples; a sample on a zero-length tail is skipped). The heading is the sample's segment's, or the next non-zero one's.
 */
export function walkSamples(line: Polyline, stepM: number, visit: (i: number, d: number, p: Probe) => void): number {
  const { points, cumulative, length } = line
  const n = Math.floor(length / stepM) + 2
  const probe: Probe = { x: 0, z: 0, hx: 0, hz: 0 }
  let seg = 0
  for (let i = 0; i < n; i++) {
    const d = Math.min(i * stepM, length)
    while (seg < points.length - 2 && cumulative[seg + 1]! <= d) seg++
    let k = seg
    while (k < points.length - 2 && cumulative[k + 1] === cumulative[k]) k++
    const a = points[k]!
    const b = points[k + 1]
    const span = b ? cumulative[k + 1]! - cumulative[k]! : 0
    if (!b || span === 0) continue
    const t = Math.min(Math.max((d - cumulative[k]!) / span, 0), 1)
    probe.x = a.x + (b.x - a.x) * t
    probe.z = a.z + (b.z - a.z) * t
    probe.hx = (b.x - a.x) / span
    probe.hz = (b.z - a.z) / span
    visit(i, d, probe)
  }
  return n
}

/** A line of the same group within this distance and heading runs on the same track: its samples are reused. */
const SAME_TRACK_M = 1
const SAME_TRACK_COS = Math.cos((2 * Math.PI) / 180)

/**
 * Line `li` of the grid (in group `own`), sampled every `sampleM` and at its end: per sample, the other groups
 * with a segment within `reachM` heading within the cosMax angle (groups stay below 31). Where an earlier line of
 * the same group (`done[j]` holds line j's samples) runs on the same track, its nearest sample is copied instead
 * of searched, so overlapping variants of one route cost one search.
 */
export function sampleNeighbours(
  search: NeighbourSearch,
  li: number,
  own: number,
  line: Polyline,
  done: readonly LineSamples[],
): LineSamples {
  const n = Math.floor(line.length / search.sampleM) + 2
  const out: LineSamples = {
    dist: new Float64Array(n),
    masks: new Int32Array(n),
    source: new Int32Array(n).fill(-1),
    sourceAt: new Int32Array(n),
  }
  walkSamples(line, search.sampleM, (i, d, p) => {
    out.dist[i] = d
    const c = cellIndex(search.grid, p.x, p.z)
    if (c < 0) return
    const [from, to] = ownRange(search.grid, c, own)
    if (!copyEarlier(search, from, to, li, p, done, out, i)) out.masks[i] = searchCell(search, c, from, to, p)
  })
  // walkSamples skips samples on a zero-length tail; their distance is still the line's end.
  for (let i = 1; i < n; i++) if (out.dist[i]! < out.dist[i - 1]!) out.dist[i] = line.length
  return out
}

/** [start, end) of the own group's items in cell c (items are grouped, then ordered by line). */
function ownRange(grid: SegmentGrid, c: number, own: number): [number, number] {
  const end = grid.start[c + 1]!
  let j = grid.start[c]!
  while (j < end && grid.group[grid.items[j]!]! !== own) j = grid.groupEnd[j]!
  return [j, j < end ? grid.groupEnd[j]! : end]
}

function copyEarlier(
  search: NeighbourSearch,
  from: number,
  to: number,
  li: number,
  p: Probe,
  done: readonly LineSamples[],
  out: LineSamples,
  i: number,
): boolean {
  const { grid, sampleM } = search
  for (let q = from; q < to; q++) {
    const r = grid.items[q]!
    const other = grid.owner[r]!
    if (other >= li) break
    if (grid.ux[r]! * p.hx + grid.uz[r]! * p.hz < SAME_TRACK_COS) continue
    const px = p.x - grid.ax[r]!
    const pz = p.z - grid.az[r]!
    const along = Math.min(Math.max(px * grid.ux[r]! + pz * grid.uz[r]!, 0), grid.len[r]!)
    if (Math.hypot(px - grid.ux[r]! * along, pz - grid.uz[r]! * along) > SAME_TRACK_M) continue
    const prev = done[other]!
    const at = Math.min(Math.round((grid.startD[r]! + along) / sampleM), prev.masks.length - 1)
    out.masks[i] = prev.masks[at]!
    out.source[i] = other
    out.sourceAt[i] = at
    return true
  }
  return false
}

function searchCell(search: NeighbourSearch, c: number, ownFrom: number, ownTo: number, p: Probe): number {
  const { grid, reachM, cosMax } = search
  let mask = 0
  // A group already found is skipped whole, and so is the own group.
  for (let j = grid.start[c]!, end = grid.start[c + 1]!; j < end; ) {
    if (j === ownFrom) {
      j = ownTo
      continue
    }
    const s = grid.items[j]!
    const bit = 1 << grid.group[s]!
    if (mask & bit || (grid.ux[s]! * p.hx + grid.uz[s]! * p.hz >= cosMax && segmentDistance(grid, s, p.x, p.z) <= reachM)) {
      mask |= bit
      j = grid.groupEnd[j]!
    } else j++
  }
  return mask
}
