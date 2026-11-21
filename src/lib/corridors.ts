/**
 * Shared corridors: where routes run side by side, each gets a band slot so the map draws them as adjacent
 * bands instead of one line hiding the others (bandOffset.ts turns a slot into a screen-pixel shift). Found once
 * at load from the drawn track lines. Pure.
 */
import type { Direction, RouteId, ShapeId } from '../data/schema'
import { buildSegmentGrid } from './corridorHash'
import { addVotes, createVotes, orderFromVotes, slotByPlace, type OrderVotes } from './corridorLateral'
import { orientRuns } from './corridorOrient'
import { slotProfile, suppressBlips } from './corridorProfile'
import { sampleNeighbours, type LineSamples } from './corridorSearch'
import type { Polyline } from './realtime/polyline'
import { EMPTY_PROFILE, type TrackProfile } from './trackProfile'

export interface CorridorOptions {
  /** Each shape is tested at points this far apart. */
  sampleM: number
  /** Another route's track within this distance of a sample, heading the same way, shares the corridor there. */
  reachM: number
  headingDeg: number
  /** A route missing for less than this between two stretches beside it still counts (a junction, a bend). */
  gapFillM: number
  /** A route beside the shape for less than this doesn't count (a crossing, a brief approach). */
  minRunM: number
  /** Length of the eased change from one slot to the next (corridorProfile.ts slotProfile). */
  taperM: number
}

/** A shape's bands along its distance. */
export interface ShapeBands {
  /** Its slot: n routes side by side sit at -(n-1)/2 .. (n-1)/2, right of travel. */
  slot: TrackProfile
  /** The corridor's half-width in slots there, (n-1)/2: bandOffset.ts splits the direction tracks once both bundles fit. */
  half: TrackProfile
}

export const NO_BANDS: ShapeBands = Object.freeze({ slot: EMPTY_PROFILE, half: EMPTY_PROFILE })

export const CORRIDOR: CorridorOptions = { sampleM: 30, reachM: 18, headingDeg: 15, gapFillM: 150, minRunM: 200, taperM: 300 }

/** Cell size of the segment grid; a few reaches wide keeps the per-cell lists short without many cells per segment. */
const CELL_M = 100

export interface CorridorShape {
  id: ShapeId
  routeId: RouteId
  direction: Direction
  /** The drawn track line (trackLine), before any resampling. */
  line: Polyline
  /** The route+direction's main shape: the others measure their order across a corridor against it. */
  primary: boolean
}

export interface CorridorRoute {
  id: RouteId
  shortName: string
}

function popcount(v: number): number {
  let c = 0
  for (let x = v; x !== 0; x &= x - 1) c++
  return c
}

/** Routes band by name, with an express variant (6X, 7X, FX) sharing its route's band. */
export function bandKey(shortName: string): string {
  return shortName.length > 1 && shortName.endsWith('X') ? shortName.slice(0, -1) : shortName
}

/**
 * Cleans one route's presence (bit `bit` of each sample's mask), in place: fills gaps of fewer than `maxGap`
 * samples between two stretches beside it, then clears stretches of fewer than `minRun` samples.
 */
export function cleanPresence(masks: Int32Array, bit: number, maxGap: number, minRun: number): void {
  const n = masks.length
  const runs = (on: boolean, apply: (i: number, j: number) => void) => {
    let i = 0
    while (i < n) {
      if (((masks[i]! & bit) !== 0) !== on) {
        i++
        continue
      }
      let j = i
      while (j < n && ((masks[j]! & bit) !== 0) === on) j++
      apply(i, j)
      i = j
    }
  }
  runs(false, (i, j) => {
    if (i > 0 && j < n && j - i < maxGap) for (let k = i; k < j; k++) masks[k]! |= bit
  })
  runs(true, (i, j) => {
    if (j - i < minRun) for (let k = i; k < j; k++) masks[k]! &= ~bit
  })
}

/**
 * Band slots along every shape that shares a corridor (shapes that never do are left out). At each sample, the
 * routes beside it (other band keys within `reachM`, heading within `headingDeg`, kept by cleanPresence) and its
 * own form a set ordered across the corridor by where their tracks lie (corridorLateral.ts), so a band shift adds
 * to the real spacing. Routes on one track are ordered by route_sort_order (`routes` order, a band key taking its
 * first route's place) times a sign that holds for each whole run beside other routes (corridorOrient.ts), so they
 * keep one order across the street. Out-and-back slot blips shorter than `minRunM` are dropped before easing.
 */
export function corridorBands(
  shapes: readonly CorridorShape[],
  routes: readonly CorridorRoute[],
  opts: CorridorOptions = CORRIDOR,
): Map<ShapeId, ShapeBands> {
  const keyRank = new Map<string, number>()
  for (const r of routes) {
    const key = bandKey(r.shortName)
    if (!keyRank.has(key)) keyRank.set(key, keyRank.size)
  }
  // Bit 31 is the sign bit of the Int32 masks, so ranks 0..30.
  if (keyRank.size > 31) throw new Error(`Corridors: ${keyRank.size} band keys; the presence masks hold at most 31`)
  const routeRank = new Map(routes.map((r) => [r.id, keyRank.get(bandKey(r.shortName))!]))
  const shapeRank = shapes.map((s) => {
    const rank = routeRank.get(s.routeId)
    if (rank === undefined) throw new Error(`Corridors: shape ${s.id} has unknown route "${s.routeId}"`)
    return rank
  })
  const cosMax = Math.cos((opts.headingDeg * Math.PI) / 180)
  const grid = buildSegmentGrid(
    shapes.map((s) => s.line.points),
    shapeRank,
    opts.reachM,
    CELL_M,
  )
  const search = { grid, reachM: opts.reachM, cosMax, sampleM: opts.sampleM }
  const primary = shapes.map((s) => s.primary)
  const maxGap = Math.ceil(opts.gapFillM / opts.sampleM)
  const minRun = Math.ceil(opts.minRunM / opts.sampleM)
  const done: LineSamples[] = []
  // Cleaned presence per shape (later shapes copy the raw samples in `done`), and its corridor runs.
  const cleaned = shapes.map((shape, si) => {
    const samples = sampleNeighbours(search, si, shapeRank[si]!, shape.line, done)
    done.push(samples)
    const masks = samples.masks.slice()
    let seen = 0
    for (const m of masks) seen |= m
    for (let bit = 1; bit <= seen && bit > 0; bit <<= 1) if (seen & bit) cleanPresence(masks, bit, maxGap, minRun)
    return { dist: samples.dist, masks, source: samples.source, sourceAt: samples.sourceAt }
  })
  let runCount = 0
  const runOf = cleaned.map(({ masks }) => {
    const out = new Int32Array(masks.length).fill(-1)
    for (let i = 0; i < masks.length; i++) {
      if (!masks[i]) continue
      if (i === 0 || !masks[i - 1]) runCount++
      out[i] = runCount - 1
    }
    return out
  })
  const { sign, group } = orientRuns(
    grid,
    shapes.map((s, i) => ({ line: s.line, southbound: s.direction === 'S', runOf: runOf[i]!, source: cleaned[i]!.source, sourceAt: cleaned[i]!.sourceAt })),
    runCount,
    opts.sampleM,
    opts.reachM,
    cosMax,
  )
  // The band order of each connected group of runs, from where the primary shapes find the others.
  const votes = new Map<number, OrderVotes>()
  const votesOf = (run: number): OrderVotes => {
    let v = votes.get(group[run]!)
    if (!v) votes.set(group[run]!, (v = createVotes()))
    return v
  }
  shapes.forEach((shape, si) => {
    if (shape.primary) addVotes(votesOf, search, si, shapeRank[si]!, shape.line, cleaned[si]!.masks, runOf[si]!, sign, primary)
  })
  const places = new Map([...votes].map(([g, v]) => [g, orderFromVotes(v)]))
  const rankOrder = orderFromVotes(createVotes())

  const out = new Map<ShapeId, ShapeBands>()
  shapes.forEach((shape, si) => {
    const { dist, masks } = cleaned[si]!
    const runs = runOf[si]!
    if (!runs.some((r) => r >= 0)) return
    const n = masks.length
    const slots = new Float64Array(n)
    const halves = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const run = runs[i]!
      if (run < 0) continue
      slots[i] = slotByPlace(places.get(group[run]!) ?? rankOrder, shapeRank[si]!, sign[run]!, masks[i]!)
      halves[i] = popcount(masks[i]!) / 2
    }
    suppressBlips(slots, minRun)
    suppressBlips(halves, minRun)
    const slot = slotProfile(slots, dist, shape.line.length, opts.taperM, masks)
    const half = slotProfile(halves, dist, shape.line.length, opts.taperM, masks)
    if (slot !== EMPTY_PROFILE || half !== EMPTY_PROFILE) out.set(shape.id, { slot, half })
  })
  return out
}
