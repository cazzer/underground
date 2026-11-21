/**
 * The band order within each connected group of corridor runs, taken from where the routes' tracks lie across the
 * corridor, so a band shift adds to the real spacing instead of cancelling it (B/D left of A/C up Central Park
 * West, where route_sort_order would put them right). Pure.
 *
 * Each route beside a primary shape votes, weighed by its offset, for the side it lies on; the group's order is the
 * one the votes favour most, starting from route_sort_order (which settles routes on one track). Slots then come
 * from that one order times each run's sign, as before, so every route on a corridor finds the same order and no
 * pair swaps sides along a run (an order per place would follow the GTFS lines' metre-scale wobble).
 */
import { cellIndex, type SegmentGrid } from './corridorHash'
import { walkSamples, type NeighbourSearch } from './corridorSearch'
import type { Polyline } from './realtime/polyline'

/** Groups (band ranks): the presence masks hold at most 31. */
export const GROUPS = 31

/** A route less than this far across from another is on its track (or within the GTFS lines' noise): no vote. */
export const LATERAL_TIE_M = 0.5

/** A vote's weight is its offset, capped here so one far-apart junction doesn't outvote a whole trunk. */
const MAX_VOTE_M = 3

/** Pairwise votes of one connected group: votes[a * GROUPS + b] is the weight for a left of b (times the sign). */
export type OrderVotes = Float64Array

export function createVotes(): OrderVotes {
  return new Float64Array(GROUPS * GROUPS)
}

/**
 * Adds line `li`'s votes (group `own`). At each sample with a run (`runOf`), each group in its cleaned mask whose
 * nearest segment within reach, heading the same way, lies LATERAL_TIE_M or more to one side votes for that side,
 * times the run's sign, so both directions of a street vote alike. A primary shape (`primary[line]`) in reach wins
 * over a nearer variant, so routes measure each other's main line.
 */
export function addVotes(
  votesOf: (run: number) => OrderVotes,
  search: NeighbourSearch,
  li: number,
  own: number,
  line: Polyline,
  masks: Int32Array,
  runOf: Int32Array,
  sign: Int8Array,
  primary: ArrayLike<boolean>,
): void {
  const { grid, reachM, cosMax } = search
  walkSamples(line, search.sampleM, (i, _d, p) => {
    const mask = masks[i]!
    const run = runOf[i]!
    if (!mask || run < 0) return
    const c = cellIndex(grid, p.x, p.z)
    if (c < 0) return
    nearestPerGroup(grid, primary, c, li, mask, p.x, p.z, p.hx, p.hz, reachM, cosMax)
    const votes = votesOf(run)
    for (let g = 0; g < GROUPS; g++) {
      const off = offset[g]!
      if (!(mask & (1 << g)) || !(Math.abs(off) >= LATERAL_TIE_M)) continue
      const w = Math.min(Math.abs(off), MAX_VOTE_M)
      // Right of travel, times the sign, is later in the order.
      if (off * sign[run]! > 0) votes[own * GROUPS + g]! += w
      else votes[g * GROUPS + own]! += w
    }
  })
}

/** The best score (distance, plus a penalty off the primary shapes) and its offset per group (scratch). */
const nearest = new Float64Array(GROUPS)
const offset = new Float64Array(GROUPS)

function nearestPerGroup(
  grid: SegmentGrid,
  primary: ArrayLike<boolean>,
  c: number,
  li: number,
  mask: number,
  x: number,
  z: number,
  hx: number,
  hz: number,
  reachM: number,
  cosMax: number,
): void {
  nearest.fill(Infinity)
  offset.fill(NaN)
  for (let j = grid.start[c]!, end = grid.start[c + 1]!; j < end; ) {
    const s = grid.items[j]!
    const g = grid.group[s]!
    if (!(mask & (1 << g)) || grid.owner[s] === li) {
      j = grid.groupEnd[j]!
      continue
    }
    j++
    if (grid.ux[s]! * hx + grid.uz[s]! * hz < cosMax) continue
    const px = grid.ax[s]! - x
    const pz = grid.az[s]! - z
    const t = Math.min(Math.max(-(px * grid.ux[s]! + pz * grid.uz[s]!), 0), grid.len[s]!)
    const qx = px + grid.ux[s]! * t
    const qz = pz + grid.uz[s]! * t
    const dist = Math.hypot(qx, qz)
    if (dist > reachM) continue
    const score = primary[grid.owner[s]!] ? dist : dist + 2 * reachM
    if (!(score < nearest[g]!)) continue
    nearest[g] = score
    // Right of travel is (-hz, hx): east when heading north (z is south).
    offset[g] = -qx * hz + qz * hx
  }
}

/**
 * Each group's place in the order the votes favour: starting from rank order, the single move of one group that
 * cuts the outvoted weight most is made, until none helps. Returns the place of each group.
 */
export function orderFromVotes(votes: OrderVotes): Int32Array {
  const order = Array.from({ length: GROUPS }, (_, g) => g)
  // Moving order[from] to index `to` changes the outvoted weight only for the groups it passes.
  const gain = (from: number, to: number): number => {
    const g = order[from]!
    let delta = 0
    if (to > from) for (let k = from + 1; k <= to; k++) delta += votes[order[k]! * GROUPS + g]! - votes[g * GROUPS + order[k]!]!
    else for (let k = to; k < from; k++) delta += votes[g * GROUPS + order[k]!]! - votes[order[k]! * GROUPS + g]!
    return delta
  }
  // Every move strictly cuts the outvoted weight, so this ends; the cap only bounds a pathological input.
  for (let pass = 0; pass < GROUPS * GROUPS; pass++) {
    let best = 1e-9
    let from = -1
    let to = -1
    for (let f = 0; f < GROUPS; f++) {
      // Nearest places first, so of equal gains the shortest move wins (the pass below puts unvoted neighbours back
      // in rank order).
      for (let step = 1; step < GROUPS; step++) {
        for (const t of [f - step, f + step]) {
          if (t < 0 || t >= GROUPS) continue
          const d = gain(f, t)
          if (d > best) {
            best = d
            from = f
            to = t
          }
        }
      }
    }
    if (from < 0) break
    const [g] = order.splice(from, 1)
    order.splice(to, 0, g!)
  }
  // Neighbours the votes don't separate go back to rank order (a swap of them changes nothing outvoted).
  for (let sorted = false; !sorted; ) {
    sorted = true
    for (let k = 0; k + 1 < GROUPS; k++) {
      const [p, q] = [order[k]!, order[k + 1]!]
      if (p > q && votes[p * GROUPS + q] === votes[q * GROUPS + p]) {
        order[k] = q
        order[k + 1] = p
        sorted = false
      }
    }
  }
  const place = new Int32Array(GROUPS)
  order.forEach((g, i) => {
    place[g] = i
  })
  return place
}

/**
 * The slot of group `own` among `mask`'s groups and its own, ordered by `place` (orderFromVotes): its place among
 * them minus their middle, times `sign`. The middle slot is 0, never -0.
 */
export function slotByPlace(place: Int32Array, own: number, sign: number, mask: number): number {
  let before = 0
  let count = 0
  for (let g = 0; g < GROUPS; g++) {
    if (!(mask & (1 << g))) continue
    count++
    if (place[g]! < place[own]!) before++
  }
  const centered = before - count / 2
  return centered === 0 ? 0 : sign * centered
}
