/** Screen-space label boxes: oriented rectangles in pixels (x right, y down), packed in a Float32Array. Pure, and
 *  allocation-free so the label pass can run per frame. */
import type { ScreenRect } from './interiorCamera'

/** Floats per box: its four corners, x then y, in order around it. */
export const BOX = 8

/** The angle of screen direction (dx, dy) turned to read left to right: wrapped into (-π/2, π/2]. Radians, clockwise
 *  on screen (y down), as CSS `rotate` takes it. */
export function uprightAngle(dx: number, dy: number): number {
  let a = Math.atan2(dy, dx)
  if (a > Math.PI / 2) a -= Math.PI
  else if (a <= -Math.PI / 2) a += Math.PI
  return a
}

/** Writes box `i`: a `w` by `h` rectangle centered on (cx, cy), turned `angle` radians clockwise. */
export function writeBox(out: Float32Array, i: number, cx: number, cy: number, w: number, h: number, angle: number): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const ux = (c * w) / 2
  const uy = (s * w) / 2
  const vx = (-s * h) / 2
  const vy = (c * h) / 2
  const o = i * BOX
  out[o] = cx - ux - vx
  out[o + 1] = cy - uy - vy
  out[o + 2] = cx + ux - vx
  out[o + 3] = cy + uy - vy
  out[o + 4] = cx + ux + vx
  out[o + 5] = cy + uy + vy
  out[o + 6] = cx - ux + vx
  out[o + 7] = cy - uy + vy
}

/** True when box `j`'s and box `i`'s projections onto the axis (ax, ay) (unit length) are more than `pad` apart. */
function separatedOn(boxes: Float32Array, i: number, j: number, ax: number, ay: number, pad: number): boolean {
  let minA = Infinity
  let maxA = -Infinity
  let minB = Infinity
  let maxB = -Infinity
  for (let k = 0; k < 4; k++) {
    const pa = boxes[i * BOX + 2 * k]! * ax + boxes[i * BOX + 2 * k + 1]! * ay
    const pb = boxes[j * BOX + 2 * k]! * ax + boxes[j * BOX + 2 * k + 1]! * ay
    if (pa < minA) minA = pa
    if (pa > maxA) maxA = pa
    if (pb < minB) minB = pb
    if (pb > maxB) maxB = pb
  }
  return maxA + pad <= minB || maxB + pad <= minA
}

/** Scratch for `boxAxis`, so the tests run without allocating. */
const axis = new Float64Array(2)
const BOX_AXES = [1, 3] as const

/** Writes into `axis` the unit direction from corner 0 to corner `c` (1 or 3: a box's two axes) of box `owner`;
 *  false for a degenerate edge. */
function boxAxis(boxes: Float32Array, owner: number, c: 1 | 3): boolean {
  const o = owner * BOX
  const ex = boxes[o + 2 * c]! - boxes[o]!
  const ey = boxes[o + 2 * c + 1]! - boxes[o + 1]!
  const len = Math.hypot(ex, ey)
  if (!(len > 0)) return false
  axis[0] = ex / len
  axis[1] = ey / len
  return true
}

function axisSeparates(boxes: Float32Array, owner: number, c: 1 | 3, i: number, j: number, pad: number): boolean {
  return boxAxis(boxes, owner, c) && separatedOn(boxes, i, j, axis[0]!, axis[1]!, pad)
}

/** Separating-axis test: boxes `i` and `j` come within `pad` px of each other (or overlap). */
export function boxesOverlap(boxes: Float32Array, i: number, j: number, pad: number): boolean {
  return !(
    axisSeparates(boxes, i, 1, i, j, pad) ||
    axisSeparates(boxes, i, 3, i, j, pad) ||
    axisSeparates(boxes, j, 1, i, j, pad) ||
    axisSeparates(boxes, j, 3, i, j, pad)
  )
}

/** Every corner of box `i` lies inside `rect`. */
export function boxInRect(boxes: Float32Array, i: number, rect: ScreenRect): boolean {
  for (let k = 0; k < 4; k++) {
    const x = boxes[i * BOX + 2 * k]!
    const y = boxes[i * BOX + 2 * k + 1]!
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false
  }
  return true
}

/** Box `i` touches `rect` (an empty rect, right ≤ left or bottom ≤ top, touches nothing). */
export function boxHitsRect(boxes: Float32Array, i: number, rect: ScreenRect): boolean {
  if (rect.right <= rect.left || rect.bottom <= rect.top) return false
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (let k = 0; k < 4; k++) {
    const x = boxes[i * BOX + 2 * k]!
    const y = boxes[i * BOX + 2 * k + 1]!
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  if (maxX <= rect.left || minX >= rect.right || maxY <= rect.top || minY >= rect.bottom) return false
  // The rect's axes don't separate them; try the box's own two axes against the rect's corners.
  const o = i * BOX
  for (const c of BOX_AXES) {
    if (!boxAxis(boxes, i, c)) continue
    const ax = axis[0]!
    const ay = axis[1]!
    let minB = Infinity
    let maxB = -Infinity
    for (let c = 0; c < 4; c++) {
      const p = boxes[o + 2 * c]! * ax + boxes[o + 2 * c + 1]! * ay
      if (p < minB) minB = p
      if (p > maxB) maxB = p
    }
    const r0 = rect.left * ax + rect.top * ay
    const r1 = rect.right * ax + rect.top * ay
    const r2 = rect.right * ax + rect.bottom * ay
    const r3 = rect.left * ax + rect.bottom * ay
    if (Math.max(r0, r1, r2, r3) <= minB || Math.min(r0, r1, r2, r3) >= maxB) return false
  }
  return true
}
