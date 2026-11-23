import type { Footprint } from './interiorFootprint'
import type { ScreenPoint, ToScreen } from './pick'

/** A drawn interior picks by its footprint only while it is at least this present (reveal opacity × presence). */
export const FOOTPRINT_PICK_MIN_OPACITY = 0.5

/**
 * Whether footprint `i` counts for a pick at reveal opacity `reveal` (interiorOpacity) and its interior's `presence`. A
 * neighbour counts by reveal × presence; the `focused` one by the reveal alone, so while a newly focused interior eases
 * in (presence.ts, 250 ms) a tap on it is never passed through to a neighbour behind it.
 */
export function footprintCounts(i: number, focused: number, reveal: number, presence: number): boolean {
  return reveal * (i === focused ? 1 : presence) >= FOOTPRINT_PICK_MIN_OPACITY
}

/** Crossing-number test: is (px, py) inside the polygon of the `n` points of `xs`, `ys` from `offset` on? */
export function insidePolygon(px: number, py: number, xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, offset = 0): boolean {
  let inside = false
  for (let i = offset, j = offset + n - 1; i < offset + n; j = i++) {
    const yi = ys[i]!
    const yj = ys[j]!
    if (yi > py !== yj > py && px < ((xs[j]! - xs[i]!) * (py - yi)) / (yj - yi) + xs[i]!) inside = !inside
  }
  return inside
}

/** Screen points of the prism's top ring (0..n-1) and bottom ring (n..2n-1), plus one side quad; grown on demand. */
let sx = new Float32Array(64)
let sy = new Float32Array(64)
const qx = new Float32Array(4)
const qy = new Float32Array(4)
const out: ScreenPoint = { x: 0, y: 0 }

/**
 * Is `click` on the footprint as drawn: the hull extruded from its lowest to its highest level at `depthScale` (the
 * interior group's scale.y), projected? Its screen shape is the union of the top, the bottom and every side. False when
 * any vertex is behind the camera (no partial footprints). Allocates only to grow its scratch.
 */
export function insideFootprint(fp: Footprint, depthScale: number, toScreen: ToScreen, click: ScreenPoint): boolean {
  const n = fp.hull.length
  if (n < 3) return false
  if (sx.length < 2 * n) {
    sx = new Float32Array(4 * n)
    sy = new Float32Array(4 * n)
  }
  const top = fp.yHigh * depthScale
  const bottom = fp.yLow * depthScale
  for (let i = 0; i < n; i++) {
    const p = fp.hull[i]!
    const x = fp.originX + p[0]
    const z = fp.originZ + p[1]
    if (!toScreen(x, top, z, out)) return false
    sx[i] = out.x
    sy[i] = out.y
    if (!toScreen(x, bottom, z, out)) return false
    sx[n + i] = out.x
    sy[n + i] = out.y
  }
  if (insidePolygon(click.x, click.y, sx, sy, n)) return true
  if (insidePolygon(click.x, click.y, sx, sy, n, n)) return true
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    qx[0] = sx[i]!
    qy[0] = sy[i]!
    qx[1] = sx[j]!
    qy[1] = sy[j]!
    qx[2] = sx[n + j]!
    qy[2] = sy[n + j]!
    qx[3] = sx[n + i]!
    qy[3] = sy[n + i]!
    if (insidePolygon(click.x, click.y, qx, qy, 4)) return true
  }
  return false
}

/**
 * The footprint a click lands on, or -1 for none. Only footprints `visible(i)` count. Inside the `focused` one (an
 * index, -1 for none) it is `focused`, whatever else overlaps there: a tap on the open interior opens nothing else.
 * Otherwise, of the others containing it, the one whose origin projects nearest the click.
 */
export function footprintAt(
  footprints: readonly Footprint[],
  visible: (i: number) => boolean,
  focused: number,
  depthScale: number,
  toScreen: ToScreen,
  click: ScreenPoint,
): number {
  const f = footprints[focused]
  if (f && visible(focused) && insideFootprint(f, depthScale, toScreen, click)) return focused
  let best = -1
  let bestPx = Infinity
  for (let i = 0; i < footprints.length; i++) {
    if (i === focused || !visible(i)) continue
    const fp = footprints[i]!
    if (!insideFootprint(fp, depthScale, toScreen, click)) continue
    if (!toScreen(fp.originX, 0, fp.originZ, out)) continue
    const d = Math.hypot(out.x - click.x, out.y - click.y)
    if (d < bestPx) {
      best = i
      bestPx = d
    }
  }
  return best
}
