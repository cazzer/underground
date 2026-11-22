/** Greedy label placement: each label, in priority order, takes its first candidate box that fits. Pure and
 *  allocation-free (it runs on the frames the view moves). */
import type { ScreenRect } from './interiorCamera'
import { boxesOverlap, boxHitsRect, boxInRect } from './labelGeometry'

/** The least gap, in px, kept between two placed labels. */
export const LABEL_PAD_PX = 2

/** Where each label may go: item i's candidates are boxes `start[i]` to `start[i] + size[i] - 1` of `boxes`
 *  (labelGeometry's packing); `order` lists the `count` items, highest priority first. */
export interface LabelCandidates {
  boxes: Float32Array
  start: Int32Array
  size: Int32Array
  order: Int16Array
  count: number
}

/** What a label must keep clear of: the first `count` packed rects of `rects` (labelGeometry's RECT floats each), and
 *  anything outside `viewport`. */
export interface LabelBounds {
  viewport: ScreenRect
  rects: Float32Array
  count: number
}

/** Box `box` (of the item at order position `r`) lies in the viewport, off every blocked rect, and clear of every
 *  item placed before position `r`. */
function fits(c: LabelCandidates, bounds: LabelBounds, out: Int16Array, r: number, box: number): boolean {
  const v = bounds.viewport
  if (!boxInRect(c.boxes, box, v.left, v.top, v.right, v.bottom)) return false
  for (let k = 0; k < bounds.count; k++) if (boxHitsRect(c.boxes, box, bounds.rects, k)) return false
  for (let q = 0; q < r; q++) {
    const j = c.order[q]!
    const pick = out[j]!
    if (pick >= 0 && boxesOverlap(c.boxes, box, c.start[j]! + pick, LABEL_PAD_PX)) return false
  }
  return true
}

/**
 * Places the items at order positions `from` to `to - 1`, highest priority first, around those placed before `from`.
 * An item takes the first candidate that lies wholly inside the viewport, touches none of the blocked rects and
 * clears every box already placed by LABEL_PAD_PX, trying `prefer[i]` (a candidate index within the item, usually
 * last frame's pick; -1 for none) before the others, so a label holds its place while it still fits. Writes the
 * chosen candidate index within the item, or -1, to `out[i]`.
 */
export function declutter(
  c: LabelCandidates,
  bounds: LabelBounds,
  prefer: Int16Array,
  out: Int16Array,
  from = 0,
  to = c.count,
): void {
  for (let r = from; r < to; r++) {
    const i = c.order[r]!
    out[i] = -1
    const n = c.size[i]!
    const s = c.start[i]!
    const p = prefer[i]!
    if (p >= 0 && p < n && fits(c, bounds, out, r, s + p)) {
      out[i] = p
      continue
    }
    for (let k = 0; k < n; k++) {
      if (k !== p && fits(c, bounds, out, r, s + k)) {
        out[i] = k
        break
      }
    }
  }
}
