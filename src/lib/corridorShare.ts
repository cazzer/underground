/**
 * Variants take their primary's bands where they run on its track. Each shape's slot and half-width tapers are
 * eased from knots on its own 30 m sample grid, so a variant on its primary's track had the same slots with knots
 * up to 15 m off: under a taper it drew beside the primary (a fraction of a pixel, several where the half-width moves
 * the direction tracks apart), and variantCover.ts couldn't leave it out. With the primary's knots there, the two get
 * the same vertices and band inputs, and the variant's trains ride where the primary's do. Pure.
 */
import type { ShapeId } from '../data/schema'
import type { CorridorShape, ShapeBands } from './corridors'
import type { SegmentGrid } from './corridorHash'
import { sharedRuns, type SharedRun } from './sharedTrack'
import { EMPTY_PROFILE, profileAt, type TrackProfile } from './trackProfile'

/** Band values are multiples of a half; this only absorbs float noise. */
const SAME_VALUE = 1e-9

const FLAT: ShapeBands = { slot: EMPTY_PROFILE, half: EMPTY_PROFILE }

/** Linear interpolation of x through the increasing `xs` to `ys`, extended with slope 1 past either end. */
function mapThrough(xs: Float64Array, ys: Float64Array, x: number): number {
  const n = xs.length
  if (x <= xs[0]!) return ys[0]! + (x - xs[0]!)
  if (x >= xs[n - 1]!) return ys[n - 1]! + (x - xs[n - 1]!)
  let lo = 0
  let hi = n - 2
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (xs[mid]! <= x) lo = mid
    else hi = mid - 1
  }
  const span = xs[lo + 1]! - xs[lo]!
  return span <= 0 ? ys[lo + 1]! : ys[lo]! + ((ys[lo + 1]! - ys[lo]!) * (x - xs[lo]!)) / span
}

/** The open (d0, d1) of each knot span that changes value. */
function eases(p: TrackProfile, toV: (d: number) => number): [number, number][] {
  const out: [number, number][] = []
  for (let k = 0; k + 1 < p.d.length; k++) if (p.y[k] !== p.y[k + 1]) out.push([toV(p.d[k]!), toV(p.d[k + 1]!)])
  return out
}

/** Where on [a, b] no ease of any profile runs: closed stretches, possibly single points. */
function flatStretches(a: number, b: number, open: [number, number][]): [number, number][] {
  const sorted = open.filter(([d0, d1]) => d1 > a && d0 < b).sort((x, y) => x[0] - y[0])
  const out: [number, number][] = []
  let at = a
  for (const [d0, d1] of sorted) {
    if (d0 >= at) out.push([at, d0])
    at = Math.max(at, d1)
  }
  if (at <= b) out.push([at, b])
  return out
}

/** A stretch of the variant (its own distances) that draws the primary's bands: knots mapped from primary distance. */
interface Piece {
  s: number
  e: number
  toV: (dp: number) => number
}

/**
 * The piece of `run` that can take the primary's bands. It must start and end where all four profiles (the
 * variant's and the primary's slot and half) are flat and the two shapes agree, so the variant's own profile hands
 * over with no jump and no cut ease; at a run end that is the variant's own start or end (a short turn) there is
 * nothing to hand over from, so the piece reaches it. Null when there is no such piece.
 */
function piece(own: ShapeBands, primary: ShapeBands, run: SharedRun, length: number): Piece | null {
  const toV = (dp: number) => mapThrough(run.p, run.v, dp)
  const toP = (dv: number) => mapThrough(run.v, run.p, dv)
  const a = run.v[0]!
  const b = run.v[run.v.length - 1]!
  const open = [...eases(own.slot, (d) => d), ...eases(own.half, (d) => d), ...eases(primary.slot, toV), ...eases(primary.half, toV)]
  const agree = ([f0, f1]: [number, number]) => {
    const f = (f0 + f1) / 2
    return (
      Math.abs(profileAt(own.slot, f) - profileAt(primary.slot, toP(f))) < SAME_VALUE &&
      Math.abs(profileAt(own.half, f) - profileAt(primary.half, toP(f))) < SAME_VALUE
    )
  }
  const flat = flatStretches(a, b, open).filter(agree)
  const s = a <= 0 ? -Infinity : flat[0]?.[0]
  const e = b >= length ? Infinity : flat.at(-1)?.[1]
  if (s === undefined || e === undefined || s > e) return null
  return { s, e, toV }
}

/**
 * `own` outside the pieces, the primary's mapped knots inside them (pieces sorted, apart). A hand-over can repeat a
 * knot (own and the primary's at one distance, same value), which profileAt reads as a zero span and lineBreaks drops
 * as a repeat; a piece reaching the variant's start can map a knot below 0, which profileAt holds from and resampleAt
 * ignores as a break.
 */
function splice(own: TrackProfile, primary: TrackProfile, pieces: readonly Piece[]): TrackProfile {
  const d: number[] = []
  const y: number[] = []
  let from = -Infinity
  const ownBetween = (lo: number, hi: number) => {
    for (let k = 0; k < own.d.length; k++) {
      // Closed: a knot of its own at a hand-over (the end of an ease) holds the value both share there.
      if (own.d[k]! >= lo && own.d[k]! <= hi) {
        d.push(own.d[k]!)
        y.push(own.y[k]!)
      }
    }
  }
  for (const pc of pieces) {
    ownBetween(from, pc.s)
    for (let k = 0; k < primary.d.length; k++) {
      const at = pc.toV(primary.d[k]!)
      if (at >= pc.s && at <= pc.e) {
        d.push(at)
        y.push(primary.y[k]!)
      }
    }
    from = pc.e
  }
  ownBetween(from, Infinity)
  return d.length === 0 ? EMPTY_PROFILE : { d: Float64Array.from(d), y: Float64Array.from(y) }
}

/** `own` (a variant's bands) with the primary's along each of `runs`, where they hand over cleanly. */
export function shareBands(own: ShapeBands, primary: ShapeBands, runs: readonly SharedRun[], length: number): ShapeBands {
  const pieces = runs.map((r) => piece(own, primary, r, length)).filter((p): p is Piece => p !== null)
  if (pieces.length === 0) return own
  return { slot: splice(own.slot, primary.slot, pieces), half: splice(own.half, primary.half, pieces) }
}

/**
 * `bands` (every shape's own, by corridorBands) with each variant's taken from its route and direction's primary
 * where it runs on the primary's track. `grid` holds every shape's line (shape i is line i, reach at least SHARE_M).
 * Like variantCover.ts, the last primary of a route and direction is the one.
 */
export function sharePrimaryBands(shapes: readonly CorridorShape[], grid: SegmentGrid, bands: Map<ShapeId, ShapeBands>): void {
  const primaries = new Map<string, number>()
  shapes.forEach((s, i) => {
    if (s.primary) primaries.set(`${s.routeId}\u0000${s.direction}`, i)
  })
  for (const s of shapes) {
    const owner = s.primary ? undefined : primaries.get(`${s.routeId}\u0000${s.direction}`)
    if (owner === undefined) continue
    const primary = shapes[owner]!
    const own = bands.get(s.id) ?? FLAT
    const theirs = bands.get(primary.id) ?? FLAT
    if (own === FLAT && theirs === FLAT) continue
    const shared = shareBands(own, theirs, sharedRuns(s.line, { line: primary.line, grid, owner }), s.line.length)
    if (shared === own) continue
    if (shared.slot === EMPTY_PROFILE && shared.half === EMPTY_PROFILE) bands.delete(s.id)
    else bands.set(s.id, shared)
  }
}
