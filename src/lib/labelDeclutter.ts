/** Greedy label placement: each label, in priority order, takes its first candidate box that fits. Pure and
 *  allocation-free (it runs on the frames the view moves). */
import type { ScreenRect } from './interiorCamera'
import { boxesOverlap, boxHitsRect, boxInRect } from './labelGeometry'

/** The least gap, in px, kept between two placed labels. */
export const LABEL_PAD_PX = 2

/** Where each label may go: item i's candidates are boxes `start[i]` to `start[i] + size[i] - 1` of `boxes`
 *  (labelGeometry's packing), and `count` items are in use. */
export interface LabelCandidates {
  boxes: Float32Array
  start: Int32Array
  size: Int32Array
  count: number
}

/** What a label must keep clear of: the first `count` packed rects of `rects` (labelGeometry's RECT floats each), and
 *  anything outside `viewport`. */
export interface LabelBounds {
  viewport: ScreenRect
  rects: Float32Array
  count: number
}

function fits(c: LabelCandidates, bounds: LabelBounds, out: Int16Array, i: number, box: number): boolean {
  const v = bounds.viewport
  if (!boxInRect(c.boxes, box, v.left, v.top, v.right, v.bottom)) return false
  for (let r = 0; r < bounds.count; r++) if (boxHitsRect(c.boxes, box, bounds.rects, r)) return false
  for (let j = 0; j < i; j++) {
    const k = out[j]!
    if (k >= 0 && boxesOverlap(c.boxes, box, c.start[j]! + k, LABEL_PAD_PX)) return false
  }
  return true
}

/**
 * Places the items, highest priority (lowest index) first. An item takes the first candidate that lies wholly inside
 * the viewport, touches none of the blocked rects and clears every box already placed by LABEL_PAD_PX, trying
 * `prefer[i]` (a candidate index within the item, usually last frame's pick; -1 for none) before the others, so a
 * label holds its place while it still fits. Writes the chosen candidate index within the item, or -1, to `out[i]`.
 */
export function declutter(c: LabelCandidates, bounds: LabelBounds, prefer: Int16Array, out: Int16Array): void {
  for (let i = 0; i < c.count; i++) {
    out[i] = -1
    const n = c.size[i]!
    const s = c.start[i]!
    const p = prefer[i]!
    if (p >= 0 && p < n && fits(c, bounds, out, i, s + p)) {
      out[i] = p
      continue
    }
    for (let k = 0; k < n; k++) {
      if (k !== p && fits(c, bounds, out, i, s + k)) {
        out[i] = k
        break
      }
    }
  }
}
