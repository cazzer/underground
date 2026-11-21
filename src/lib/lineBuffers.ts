import type { RouteId } from '../data/schema'
import type { ShapePath } from './network'
import type { Ground } from './projection'
import { miterNormals } from './trackOffset'

export type Rgb = readonly [number, number, number]

export interface LineBuffers {
  /** Six floats per segment: start xyz, end xyz (y from the shape's profile, `path.y`). */
  positions: Float32Array
  /** Six floats per segment, matching `positions`. */
  colors: Float32Array
  /**
   * Eight floats per segment, the band offset's inputs at the start then the end: the point's miter normal
   * (right of travel) scaled by its length factor 1 / cosHalf (mx, mz), its band slot (`path.band`) and its
   * corridor's half-width in slots (`path.bandHalf`). Route
   * lines carry it (useLineLayer then draws them with the band offset); other line layers leave it out.
   */
  bands?: Float32Array
}

/**
 * Flattens shape paths into LineSegments2 buffers. Segments draw in buffer order, so the order
 * is the overlap rule: non-primary shapes first, then by route order, then by id; the last
 * one drawn wins where tracks are shared. `colorOf` must return linear RGB (three.js Color).
 */
export function buildLineBuffers(
  paths: readonly ShapePath[],
  routeOrder: ReadonlyMap<RouteId, number>,
  colorOf: (routeId: RouteId) => Rgb,
): Required<LineBuffers> {
  const rank = (p: ShapePath) => routeOrder.get(p.routeId) ?? Infinity
  const sorted = [...paths].sort(
    (a, b) =>
      Number(a.primary) - Number(b.primary) || rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const segments = sorted.reduce((n, p) => n + Math.max(p.points.length - 1, 0), 0)
  const positions = new Float32Array(segments * 6)
  const colors = new Float32Array(segments * 6)
  const bands = new Float32Array(segments * 8)
  let o = 0
  let ob = 0
  for (const path of sorted) {
    const [r, g, b] = colorOf(path.routeId)
    writeBandInputs(path.points, path.band, path.bandHalf, bands, ob)
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]!
      const c = path.points[i]!
      positions.set([a.x, path.y[i - 1]!, a.z, c.x, path.y[i]!, c.z], o)
      colors.set([r, g, b, r, g, b], o)
      o += 6
      ob += 8
    }
  }
  return { positions, colors, bands }
}

/**
 * Writes the band inputs (LineBuffers.bands layout) of the polyline `points`, one segment per consecutive pair,
 * into `out` from float `offset`. Any other line layer drawn over a route line (a mask over a platform stretch,
 * say) passes its points and their slots (profileAt(path.bands.slot, d)) through this and draws with
 * useLineLayer, so it moves with the route line (`half` likewise from bands.half). A polyline with no direction
 * (all points equal) has no normal: its entries stay 0 and it is drawn unshifted.
 */
export function writeBandInputs(
  points: readonly Ground[],
  band: readonly number[],
  half: readonly number[],
  out: Float32Array,
  offset = 0,
): void {
  const miters = miterNormals(points)
  if (!miters) return
  for (let i = 1; i < points.length; i++) {
    const ma = miters[i - 1]!
    const mc = miters[i]!
    const a = 1 / ma.cosHalf
    const c = 1 / mc.cosHalf
    out.set([ma.x * a, ma.z * a, band[i - 1]!, half[i - 1]!, mc.x * c, mc.z * c, band[i]!, half[i]!], offset + (i - 1) * 8)
  }
}
