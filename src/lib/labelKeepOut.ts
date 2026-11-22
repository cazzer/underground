/**
 * The top (px) for a label centred on `x` with its top edge at `top`, `w` by `h` px, moved down just past every screen
 * point in `xy` (`n` x, y pairs; NaN for a point not on screen) that lies within `pad` px of it, so a level label never
 * sits on the exit path's start. Unchanged when none is near. Repeats while a move brings another point in, at most
 * `n` times. No allocation.
 */
export function clearLabelTop(x: number, top: number, w: number, h: number, xy: Float32Array, n: number, pad: number): number {
  let t = top
  for (let pass = 0; pass <= n; pass++) {
    let moved = false
    for (let k = 0; k < n; k++) {
      const px = xy[2 * k]!
      const py = xy[2 * k + 1]!
      if (px >= x - w / 2 - pad && px <= x + w / 2 + pad && py > t - pad && py < t + h + pad) {
        t = py + pad
        moved = true
      }
    }
    if (!moved) break
  }
  return t
}
