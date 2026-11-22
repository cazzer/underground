/** Screen-space label boxes: oriented rectangles in pixels (x right, y down), packed in a Float32Array, and blocked
 *  rects packed four floats each (left, top, right, bottom). Pure, and allocation-free so the label pass can run per
 *  frame. */

/** Floats per box: its four corners (x then y, in order around it), its bounds (minX, minY, maxX, maxY), and the
 *  cosine and sine of its angle (its long axis is (cos, sin), its short one (-sin, cos)). */
export const BOX = 14
const AABB = 8
const AXIS = 12
/** Floats per packed rect. */
export const RECT = 4

/** How far past vertical (radians) a turned label keeps its reading direction before it flips. */
export const UPRIGHT_HYSTERESIS = (15 * Math.PI) / 180

/**
 * The angle of screen direction (dx, dy) turned to read left to right: wrapped into (-π/2, π/2], radians clockwise
 * on screen (y down), as CSS `rotate` takes it. Given `prev` (last frame's angle for this label; NaN for none), the
 * reading direction is kept until the line turns UPRIGHT_HYSTERESIS past vertical, so a label near vertical
 * doesn't flip back and forth.
 */
export function uprightAngle(dx: number, dy: number, prev = NaN): number {
  let a = Math.atan2(dy, dx)
  if (a > Math.PI / 2) a -= Math.PI
  else if (a <= -Math.PI / 2) a += Math.PI
  if (!Number.isFinite(prev)) return a
  // The other reading of the same line, on the far side of vertical.
  const flipped = a > 0 ? a - Math.PI : a + Math.PI
  const limit = Math.PI / 2 + UPRIGHT_HYSTERESIS
  if (Math.abs(flipped - prev) < Math.abs(a - prev) && Math.abs(flipped) <= limit) return flipped
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
  const ex = Math.abs(ux) + Math.abs(vx)
  const ey = Math.abs(uy) + Math.abs(vy)
  out[o + AABB] = cx - ex
  out[o + AABB + 1] = cy - ey
  out[o + AABB + 2] = cx + ex
  out[o + AABB + 3] = cy + ey
  out[o + AXIS] = c
  out[o + AXIS + 1] = s
}

/** Box `i`'s and box `j`'s projections onto the unit axis (ax, ay) are at least `pad` apart. */
function separatedOn(boxes: Float32Array, i: number, j: number, ax: number, ay: number, pad: number): boolean {
  let minA = Infinity
  let maxA = -Infinity
  let minB = Infinity
  let maxB = -Infinity
  for (let corner = 0; corner < 4; corner++) {
    const pa = boxes[i * BOX + 2 * corner]! * ax + boxes[i * BOX + 2 * corner + 1]! * ay
    const pb = boxes[j * BOX + 2 * corner]! * ax + boxes[j * BOX + 2 * corner + 1]! * ay
    if (pa < minA) minA = pa
    if (pa > maxA) maxA = pa
    if (pb < minB) minB = pb
    if (pb > maxB) maxB = pb
  }
  return maxA + pad <= minB || maxB + pad <= minA
}

/** One of `owner`'s two axes (long, then short) separates boxes `i` and `j` by `pad`. */
function ownAxesSeparate(boxes: Float32Array, owner: number, i: number, j: number, pad: number): boolean {
  const c = boxes[owner * BOX + AXIS]!
  const s = boxes[owner * BOX + AXIS + 1]!
  return separatedOn(boxes, i, j, c, s, pad) || separatedOn(boxes, i, j, -s, c, pad)
}

/** Boxes `i` and `j` come within `pad` px of each other (or overlap): bounds first, then the separating-axis test. */
export function boxesOverlap(boxes: Float32Array, i: number, j: number, pad: number): boolean {
  const a = i * BOX + AABB
  const b = j * BOX + AABB
  if (boxes[a + 2]! + pad <= boxes[b]! || boxes[b + 2]! + pad <= boxes[a]!) return false
  if (boxes[a + 3]! + pad <= boxes[b + 1]! || boxes[b + 3]! + pad <= boxes[a + 1]!) return false
  return !(ownAxesSeparate(boxes, i, i, j, pad) || ownAxesSeparate(boxes, j, i, j, pad))
}

/** Every corner of box `i` lies inside the rect (left, top, right, bottom). */
export function boxInRect(boxes: Float32Array, i: number, left: number, top: number, right: number, bottom: number): boolean {
  const o = i * BOX + AABB
  return boxes[o]! >= left && boxes[o + 1]! >= top && boxes[o + 2]! <= right && boxes[o + 3]! <= bottom
}

/** Box `i` touches packed rect `r` of `rects` (an empty rect, right ≤ left or bottom ≤ top, touches nothing). */
export function boxHitsRect(boxes: Float32Array, i: number, rects: Float32Array, r: number): boolean {
  const left = rects[r * RECT]!
  const top = rects[r * RECT + 1]!
  const right = rects[r * RECT + 2]!
  const bottom = rects[r * RECT + 3]!
  if (right <= left || bottom <= top) return false
  const o = i * BOX
  if (boxes[o + AABB + 2]! <= left || boxes[o + AABB]! >= right) return false
  if (boxes[o + AABB + 3]! <= top || boxes[o + AABB + 1]! >= bottom) return false
  // The rect's own axes don't separate them; try the box's two axes against the rect's corners.
  const c = boxes[o + AXIS]!
  const s = boxes[o + AXIS + 1]!
  return !(rectSeparatedOn(boxes, i, c, s, left, top, right, bottom) || rectSeparatedOn(boxes, i, -s, c, left, top, right, bottom))
}

function rectSeparatedOn(
  boxes: Float32Array,
  i: number,
  ax: number,
  ay: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): boolean {
  let minB = Infinity
  let maxB = -Infinity
  for (let corner = 0; corner < 4; corner++) {
    const p = boxes[i * BOX + 2 * corner]! * ax + boxes[i * BOX + 2 * corner + 1]! * ay
    if (p < minB) minB = p
    if (p > maxB) maxB = p
  }
  const r0 = left * ax + top * ay
  const r1 = right * ax + top * ay
  const r2 = right * ax + bottom * ay
  const r3 = left * ax + bottom * ay
  return Math.max(r0, r1, r2, r3) <= minB || Math.min(r0, r1, r2, r3) >= maxB
}

/** Writes packed rect `r`. */
export function writeRect(rects: Float32Array, r: number, left: number, top: number, right: number, bottom: number): void {
  rects[r * RECT] = left
  rects[r * RECT + 1] = top
  rects[r * RECT + 2] = right
  rects[r * RECT + 3] = bottom
}
