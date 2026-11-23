/** Greedy label placement: each label, in priority order, takes its first candidate box that fits. Pure and
 *  allocation-free (it runs on the frames the view moves). */
import type { ScreenRect } from './interiorCamera'
import { BOX, BOX_BOUNDS, boxesOverlap, boxHitsRect, boxInRect } from './labelGeometry'

/** The least gap, in px, kept between two placed labels. */
export const LABEL_PAD_PX = 2

/** Floats per rect group: its first rect, one past its last, then the bounds of its rects (left, top, right, bottom). */
export const GROUP = 6

/** Where each label may go: item i's candidates are boxes `start[i]` to `start[i] + size[i] - 1` of `boxes`
 *  (labelGeometry's packing); `order` lists the `count` items, highest priority first. */
export interface LabelCandidates {
  boxes: Float32Array
  start: Int32Array
  size: Int32Array
  order: Int16Array
  count: number
}

/**
 * What a label must keep clear of: the first `count` packed rects of `rects` (labelGeometry's RECT floats each), and
 * anything outside `viewport`. `exempt` lets an item ignore a rect (a marker its own mark sits in): bit `item & 31` of
 * word `rect * exemptWords + (item >>> 5)` (setExempt); it may cover only the first rects, those past it are never
 * exempt. With `groups` (`groupCount` of them, GROUP floats each, every
 * rect below `count` in one), a box whose bounds miss a group's skips its rects; without, every rect is tested.
 */
export interface LabelBounds {
  viewport: ScreenRect
  rects: Float32Array
  count: number
  exempt?: Uint32Array
  exemptWords?: number
  groups?: Float32Array
  groupCount?: number
}

/** Lets item `item` ignore rect `rect`. */
export function setExempt(b: LabelBounds, rect: number, item: number): void {
  const exempt = b.exempt!
  const o = rect * (b.exemptWords ?? 1) + (item >>> 5)
  if (o >= exempt.length) throw new Error(`Label exemption for rect ${rect} past the ${exempt.length} words held`)
  exempt[o] = exempt[o]! | (1 << (item & 31))
}

export function isExempt(b: LabelBounds, rect: number, item: number): boolean {
  const exempt = b.exempt
  if (!exempt) return false
  const words = b.exemptWords ?? 1
  const o = rect * words + (item >>> 5)
  if (item >>> 5 >= words || o >= exempt.length) return false
  return ((exempt[o]! >>> (item & 31)) & 1) === 1
}

function hitsRects(c: LabelCandidates, bounds: LabelBounds, item: number, box: number, first: number, end: number): boolean {
  for (let k = first; k < end; k++) {
    if (boxHitsRect(c.boxes, box, bounds.rects, k) && !isExempt(bounds, k, item)) return true
  }
  return false
}

/** Box `box` touches a blocked rect `item` isn't exempt from, skipping the groups its bounds miss. */
function blocked(c: LabelCandidates, bounds: LabelBounds, item: number, box: number): boolean {
  const groups = bounds.groups
  if (!groups) return hitsRects(c, bounds, item, box, 0, bounds.count)
  const o = box * BOX + BOX_BOUNDS
  const minX = c.boxes[o]!
  const minY = c.boxes[o + 1]!
  const maxX = c.boxes[o + 2]!
  const maxY = c.boxes[o + 3]!
  for (let g = 0, n = bounds.groupCount ?? 0; g < n; g++) {
    const q = g * GROUP
    const first = groups[q]!
    if (first >= bounds.count) continue
    if (maxX <= groups[q + 2]! || minX >= groups[q + 4]! || maxY <= groups[q + 3]! || minY >= groups[q + 5]!) continue
    if (hitsRects(c, bounds, item, box, first, Math.min(groups[q + 1]!, bounds.count))) return true
  }
  return false
}

/** Box `box` (of the item at order position `r`) lies in the viewport, off every blocked rect, and clear of every
 *  item placed before position `r`. */
function fits(c: LabelCandidates, bounds: LabelBounds, out: Int16Array, r: number, box: number): boolean {
  const v = bounds.viewport
  if (!boxInRect(c.boxes, box, v.left, v.top, v.right, v.bottom)) return false
  if (blocked(c, bounds, c.order[r]!, box)) return false
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
 * chosen candidate index within the item, or -1, to `out[i]`. Once `limit` items are placed the rest get -1 untested.
 * Returns how many it placed.
 */
export function declutter(
  c: LabelCandidates,
  bounds: LabelBounds,
  prefer: Int16Array,
  out: Int16Array,
  from = 0,
  to = c.count,
  limit = Infinity,
): number {
  let placed = 0
  for (let r = from; r < to; r++) {
    const i = c.order[r]!
    out[i] = -1
    if (placed >= limit) continue
    const n = c.size[i]!
    const s = c.start[i]!
    const p = prefer[i]!
    if (p >= 0 && p < n && fits(c, bounds, out, r, s + p)) {
      out[i] = p
      placed++
      continue
    }
    for (let k = 0; k < n; k++) {
      if (k !== p && fits(c, bounds, out, r, s + k)) {
        out[i] = k
        placed++
        break
      }
    }
  }
  return placed
}
