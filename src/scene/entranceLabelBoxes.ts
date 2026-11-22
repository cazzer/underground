import type { Vector3 } from 'three'
import { RECT } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import { addBox, ENTRANCE_SLOTS, groundHalfPx, onScreen, toScreen, type LabelPlacement, type PlacementView } from './labelPlacementState'

/** Gap between an entrance mark's edge and a label beside it, px; and above or below it. */
const SIDE_GAP_PX = 6
const END_GAP_PX = 3
/** Rank tiers, far above any screen distance: the trip's exit (`view.priorityEntrance`), an elevator, then a label no
 *  other entrance shares, then the best of each head house before any head house's second. */
const EXIT_TIER = 8e9
const ELEVATOR_TIER = 4e9
const UNIQUE_TIER = 2e9
const HOUSE_TIER = 1e9
/** Last placement's winners rank this many px nearer, so a small pan doesn't swap two labels' ranks. */
export const STICKY_PX = 48

/** Lets entrance `i` ignore the station marker rects (from `first`, `count` of them) its own mark sits in. */
function exemptOwnMarker(p: LabelPlacement, i: number, x: number, y: number, first: number, count: number): void {
  if (i >= 32) return
  const rects = p.bounds.rects
  const exempt = p.bounds.exempt!
  for (let k = first; k < first + count; k++) {
    const o = k * RECT
    if (x >= rects[o]! && x <= rects[o + 2]! && y >= rects[o + 1]! && y <= rects[o + 3]!) exempt[k] = exempt[k]! | (1 << i)
  }
}

/**
 * Entrance `i`'s candidates around its mark; returns the next free box. Right and left of the mark, with its first
 * line level with the mark; then above-right, below-right, above-left and below-left, the label's near corner at the
 * mark's, so the label reads as attached to its mark. The station marker rects from `markerRect` (`markerCount` of
 * them) that hold the mark don't block it.
 */
export function entranceBoxes(
  p: LabelPlacement,
  i: number,
  anchor: Ground,
  view: PlacementView,
  a: Vector3,
  b: Vector3,
  box: number,
  markerRect: number,
  markerCount: number,
): number {
  const e = p.entrances[i]!
  p.cand.start[i] = box
  p.cand.size[i] = 0
  p.prefer[i] = view.fresh && !p.lastFirst[i] ? -1 : p.lastSrc[i]!
  const x = anchor.x + e.x
  const z = anchor.z + e.z
  if (!toScreen(a, x, 0, z, view) || !onScreen(a, view)) return box
  p.markX[i] = a.x
  p.markY[i] = a.y
  exemptOwnMarker(p, i, a.x, a.y, markerRect, markerCount)
  const half = groundHalfPx(a, b, x, z, view.markHalfM, view)
  const w = p.w[i]!
  const h = p.h[i]!
  const side = half + SIDE_GAP_PX + w / 2
  // The first line's middle on the mark: half the label down, less half a line.
  const level = a.y + h / 2 - h / p.lines[i]! / 2
  const up = a.y - half - END_GAP_PX - h / 2
  const down = a.y + half + END_GAP_PX + h / 2
  addBox(p, box, i, a.x + side, level, 0)
  addBox(p, box + 1, i, a.x - side, level, 0)
  addBox(p, box + 2, i, a.x - half + w / 2, up, 0)
  addBox(p, box + 3, i, a.x - half + w / 2, down, 0)
  addBox(p, box + 4, i, a.x + half - w / 2, up, 0)
  addBox(p, box + 5, i, a.x + half - w / 2, down, 0)
  p.cand.size[i] = ENTRANCE_SLOTS
  return box + ENTRANCE_SLOTS
}

/**
 * Orders the entrances (order positions 0 to E - 1): the trip's exit first, then elevators, then labels no other entrance shares; within
 * those, the best of each head house before any second, then nearest the free area's middle on screen, last
 * placement's winners STICKY_PX nearer. Entrances off screen have no candidates, so their rank doesn't matter.
 * Insertion sort over a few items; no allocation.
 */
export function rankEntrances(p: LabelPlacement, view: PlacementView): void {
  const n = p.entrances.length
  const order = p.cand.order
  p.houseBest.fill(Infinity)
  for (let i = 0; i < n; i++) {
    const e = p.entrances[i]!
    const near = p.cand.size[i]! > 0 ? Math.hypot(p.markX[i]! - view.focusX, p.markY[i]! - view.focusY) : 1e8
    p.score[i] = (e.members.includes(view.priorityEntrance) ? 0 : EXIT_TIER) + (e.elevator ? 0 : ELEVATOR_TIER) + (e.unique ? 0 : UNIQUE_TIER) + near - (p.lastSrc[i]! >= 0 ? STICKY_PX : 0)
    if (p.score[i]! < p.houseBest[e.headHouse]!) p.houseBest[e.headHouse] = p.score[i]!
    order[i] = i
  }
  for (let i = 0; i < n; i++) if (p.score[i]! > p.houseBest[p.entrances[i]!.headHouse]!) p.score[i] = p.score[i]! + HOUSE_TIER
  for (let r = 1; r < n; r++) {
    const item = order[r]!
    const s = p.score[item]!
    let q = r - 1
    while (q >= 0 && p.score[order[q]!]! > s) {
      order[q + 1] = order[q]!
      q--
    }
    order[q + 1] = item
  }
}
