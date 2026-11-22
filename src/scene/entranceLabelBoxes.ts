import type { Vector3 } from 'three'
import type { Ground } from '../lib/projection'
import { addBox, ENTRANCE_SLOTS, groundHalfPx, onScreen, toScreen, type LabelPlacement, type PlacementView } from './labelPlacementState'

/** Gap between an entrance mark's edge and a label beside it, px; and above or below it. */
const SIDE_GAP_PX = 6
const END_GAP_PX = 3
/** Rank tiers, far above any screen distance: an elevator first, then a label no other entrance shares. */
const ELEVATOR_TIER = 2e9
const UNIQUE_TIER = 1e9

/**
 * Entrance `i`'s candidates around its mark; returns the next free box. Right and left of the mark, centered on it;
 * then above-right, below-right, above-left and below-left, the label's near corner at the mark's, so the label
 * reads as attached to its mark.
 */
export function entranceBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number): number {
  const e = p.entrances[i]!
  p.cand.start[i] = box
  p.cand.size[i] = 0
  p.prefer[i] = view.fresh ? -1 : p.lastSrc[i]!
  const x = anchor.x + e.x
  const z = anchor.z + e.z
  if (!toScreen(a, x, 0, z, view) || !onScreen(a, view)) return box
  p.markX[i] = a.x
  p.markY[i] = a.y
  const half = groundHalfPx(a, b, x, z, view.markHalfM, view)
  const w = p.w[i]!
  const h = p.h[i]!
  const side = half + SIDE_GAP_PX + w / 2
  const up = a.y - half - END_GAP_PX - h / 2
  const down = a.y + half + END_GAP_PX + h / 2
  addBox(p, box, i, a.x + side, a.y, 0)
  addBox(p, box + 1, i, a.x - side, a.y, 0)
  addBox(p, box + 2, i, a.x - half + w / 2, up, 0)
  addBox(p, box + 3, i, a.x - half + w / 2, down, 0)
  addBox(p, box + 4, i, a.x + half - w / 2, up, 0)
  addBox(p, box + 5, i, a.x + half - w / 2, down, 0)
  p.cand.size[i] = ENTRANCE_SLOTS
  return box + ENTRANCE_SLOTS
}

/**
 * Orders the entrances (order positions 0 to E - 1): elevators first, then labels no other entrance shares, then
 * nearest the free area's middle on screen. Entrances off screen have no candidates, so their rank doesn't matter.
 * Insertion sort over a few items; no allocation.
 */
export function rankEntrances(p: LabelPlacement, view: PlacementView): void {
  const n = p.entrances.length
  const order = p.cand.order
  for (let i = 0; i < n; i++) {
    const e = p.entrances[i]!
    const near = p.cand.size[i]! > 0 ? Math.hypot(p.markX[i]! - view.focusX, p.markY[i]! - view.focusY) : 1e8
    p.score[i] = (e.elevator ? 0 : ELEVATOR_TIER) + (e.unique ? 0 : UNIQUE_TIER) + near
    order[i] = i
  }
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
