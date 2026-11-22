/** Clipping tile-local segments to the tile square, so neighbouring tiles never draw the same stroke twice. */

/**
 * Liang–Barsky: clips a→b to [lo, hi]² and writes the clipped ends to `out` (ax, ay, bx, by); false when no
 * part of it is inside. Allocation-free.
 */
export function clipSegment(ax: number, ay: number, bx: number, by: number, lo: number, hi: number, out: Float64Array): boolean {
  const dx = bx - ax
  const dy = by - ay
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    // The four edges as p·t <= q: left, right, top, bottom.
    const p = i === 0 ? -dx : i === 1 ? dx : i === 2 ? -dy : dy
    const q = i === 0 ? ax - lo : i === 1 ? hi - ax : i === 2 ? ay - lo : hi - ay
    if (p === 0) {
      if (q < 0) return false
      continue
    }
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
  }
  out[0] = ax + t0 * dx
  out[1] = ay + t0 * dy
  out[2] = ax + t1 * dx
  out[3] = ay + t1 * dy
  return true
}

/**
 * A polygon ring's segment lying along one tile edge (both ends within `tol` of it): the tiler's cut through
 * the polygon, not a real shoreline or park edge.
 */
export function onTileEdge(ax: number, ay: number, bx: number, by: number, lo: number, hi: number, tol = 0.5): boolean {
  return (
    (Math.abs(ax - lo) <= tol && Math.abs(bx - lo) <= tol) ||
    (Math.abs(ax - hi) <= tol && Math.abs(bx - hi) <= tol) ||
    (Math.abs(ay - lo) <= tol && Math.abs(by - lo) <= tol) ||
    (Math.abs(ay - hi) <= tol && Math.abs(by - hi) <= tol)
  )
}
