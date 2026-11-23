/** Rect groups for the label declutter (labelDeclutter.ts GROUP): a run of packed rects and the bounds that hold
 *  them, so a box far from the run skips it. Pure, allocation-free. */
import { GROUP } from './labelDeclutter'
import { RECT } from './labelGeometry'

/** Writes group `g` as rects `first` to `end - 1` of `rects` with the bounds of their non-empty ones; with none, an
 *  empty bounds (left +Infinity) that no box touches. */
export function closeGroup(groups: Float32Array, g: number, rects: Float32Array, first: number, end: number): void {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (let k = first; k < end; k++) {
    const o = k * RECT
    const l = rects[o]!
    const t = rects[o + 1]!
    const r = rects[o + 2]!
    const b = rects[o + 3]!
    if (r <= l || b <= t) continue
    if (l < left) left = l
    if (t < top) top = t
    if (r > right) right = r
    if (b > bottom) bottom = b
  }
  const q = g * GROUP
  groups[q] = first
  groups[q + 1] = end
  groups[q + 2] = left
  groups[q + 3] = top
  groups[q + 4] = right
  groups[q + 5] = bottom
}
