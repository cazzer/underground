/**
 * Which stretches of a street piece run under a drawn route line, so the street layers can leave them out: a 1 px
 * street centerline inside a route bundle reads as one more track (ost.10). A street piece is cut where it runs
 * within ROUTE_CLIP_M of a track and within CLIP_MAX_DEG of its direction; crossings and streets beside a bundle
 * stay. Tracks are the unbanded ground paths (`network.shapes` points) the band shader shifts. Pure; the grid is
 * built once, and `keptPieces` allocates nothing once its output array has grown.
 */
import { buildSegmentGrid, type SegmentGrid } from './corridorHash'
import type { Ground } from './projection'

/** A street piece this close to a track (and along it) is cut, meters; routeBundles' wider ROUTE_NEAR_M is for labels. */
export const ROUTE_CLIP_M = 5
/** A street runs along a track only within this angle of it, degrees. */
export const CLIP_MAX_DEG = 15
const CLIP_MIN_COS = Math.cos((CLIP_MAX_DEG * Math.PI) / 180)
/** A track segment covers the street this far past either of its ends, so a bend leaves no sliver. */
export const CLIP_END_PAD_M = 3
/** The farthest a covered street point can be from its track segment (across by ROUTE_CLIP_M, past an end by the pad). */
export const CLIP_TRACK_REACH_M = Math.hypot(ROUTE_CLIP_M, CLIP_END_PAD_M)
/** The grid's cell, meters. */
export const CLIP_CELL_M = 100
/** A street is sampled this often to find the cells it passes, meters. */
const CLIP_SAMPLE_M = CLIP_CELL_M / 2
/**
 * How far from a track segment its cells reach: every street point is within half the sampling of a sample, and a
 * covered point within CLIP_TRACK_REACH_M of its segment, so the sample's cell lists that segment.
 */
const CLIP_REACH_M = CLIP_TRACK_REACH_M + CLIP_SAMPLE_M / 2
/** A kept stretch shorter than this, left by a cut, is dropped too. */
export const CLIP_MIN_PIECE_M = 2

/** The part of the corridor grid (corridorHash.ts) the clip reads; the group and line indexes are let go. */
type ClipGrid = Pick<SegmentGrid, 'cellM' | 'minX' | 'minZ' | 'nx' | 'nz' | 'start' | 'items' | 'ax' | 'az' | 'ux' | 'uz' | 'len'>

export interface RouteClip {
  grid: ClipGrid
  /** Per segment, the last call that looked at it: each candidate is tested once per call. */
  stamp: Int32Array
  call: number
  /** Covered t-intervals of the current call, two floats each; grows when a call needs more. */
  covered: Float64Array
}

/** The clip for these tracks (scene ground points, any frame, as long as the streets share it). */
export function buildRouteClip(tracks: readonly (readonly Ground[])[]): RouteClip {
  const { cellM, minX, minZ, nx, nz, start, items, ax, az, ux, uz, len } = buildSegmentGrid(
    tracks,
    new Int32Array(tracks.length),
    CLIP_REACH_M,
    CLIP_CELL_M,
  )
  const grid: ClipGrid = { cellM, minX, minZ, nx, nz, start, items, ax, az, ux, uz, len }
  return { grid, stamp: new Int32Array(grid.len.length).fill(-1), call: 0, covered: new Float64Array(64) }
}

/** The grid cell of (x, z), or -1 outside it (as corridorHash's cellIndex). */
function cellOf(g: ClipGrid, x: number, z: number): number {
  const ix = Math.floor((x - g.minX) / g.cellM)
  const iz = Math.floor((z - g.minZ) / g.cellM)
  return ix < 0 || iz < 0 || ix >= g.nx || iz >= g.nz ? -1 : ix * g.nz + iz
}

/** Intersects [lo, hi] with {t : |c0 + c1 t| ≤ r}; returns false when empty. Writes the result into `range`. */
function within(c0: number, c1: number, r: number, range: Float64Array): boolean {
  if (c1 === 0) return Math.abs(c0) <= r
  const a = (-r - c0) / c1
  const b = (r - c0) / c1
  range[0] = Math.max(range[0]!, Math.min(a, b))
  range[1] = Math.min(range[1]!, Math.max(a, b))
  return range[0]! < range[1]!
}

const range = new Float64Array(2)

/** Adds track segment s's cover of the street a + t (b - a), t in [0, 1], to the clip's list; returns the count. */
function addCover(clip: RouteClip, s: number, ax: number, az: number, dx: number, dz: number, len: number, n: number): number {
  const g = clip.grid
  const ux = g.ux[s]!
  const uz = g.uz[s]!
  if (Math.abs((dx * ux + dz * uz) / len) < CLIP_MIN_COS) return n
  const px = ax - g.ax[s]!
  const pz = az - g.az[s]!
  range[0] = 0
  range[1] = 1
  // Across the track (its left normal) and along it, both linear in t.
  const half = (g.len[s]! + 2 * CLIP_END_PAD_M) / 2
  if (!within(px * -uz + pz * ux, dx * -uz + dz * ux, ROUTE_CLIP_M, range)) return n
  if (!within(px * ux + pz * uz - g.len[s]! / 2, dx * ux + dz * uz, half, range)) return n
  if (2 * n + 2 > clip.covered.length) {
    const grown = new Float64Array(clip.covered.length * 2)
    grown.set(clip.covered)
    clip.covered = grown
  }
  // Insertion by start, so the union below is one pass.
  const c = clip.covered
  let i = n
  while (i > 0 && c[2 * i - 2]! > range[0]!) {
    c[2 * i] = c[2 * i - 2]!
    c[2 * i + 1] = c[2 * i - 1]!
    i--
  }
  c[2 * i] = range[0]!
  c[2 * i + 1] = range[1]!
  return n + 1
}

/**
 * The stretches of the street piece a→b (same frame as the clip's tracks) to draw, as (t0, t1) pairs of its
 * parameter written into `out` (cleared first); returns the pair count. An untouched piece comes back whole
 * as (0, 1), whatever its length; a stretch left by a cut is kept only from CLIP_MIN_PIECE_M.
 */
export function keptPieces(clip: RouteClip, ax: number, az: number, bx: number, bz: number, out: number[]): number {
  out.length = 0
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz)
  if (!(len > 0)) {
    out.push(0, 1)
    return 1
  }
  const g = clip.grid
  const call = ++clip.call
  const steps = Math.ceil(len / CLIP_SAMPLE_M)
  let n = 0
  let lastCell = -1
  for (let k = 0; k <= steps; k++) {
    const cell = cellOf(g, ax + (dx * k) / steps, az + (dz * k) / steps)
    if (cell < 0 || cell === lastCell) continue
    lastCell = cell
    for (let j = g.start[cell]!; j < g.start[cell + 1]!; j++) {
      const s = g.items[j]!
      if (clip.stamp[s] === call) continue
      clip.stamp[s] = call
      n = addCover(clip, s, ax, az, dx, dz, len, n)
    }
  }
  if (n === 0) {
    out.push(0, 1)
    return 1
  }
  const c = clip.covered
  const minT = CLIP_MIN_PIECE_M / len
  let from = 0
  for (let i = 0; i < n; i++) {
    const lo = c[2 * i]!
    if (lo - from >= minT) out.push(from, lo)
    from = Math.max(from, c[2 * i + 1]!)
  }
  if (1 - from >= minT) out.push(from, 1)
  return out.length / 2
}
