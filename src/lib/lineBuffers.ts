import type { RouteId, ShapeId } from '../data/schema'
import type { ShapePath } from './network'
import type { Ground } from './projection'
import { miterNormals } from './trackOffset'

export type Rgb = readonly [number, number, number]

/** Floats per point in a band-input array (vertexBandInputs). */
export const BAND_INPUTS = 4

export interface LineBuffers {
  /** Six floats per segment: start xyz, end xyz (y from the shape's profile, `path.y`). */
  positions: Float32Array
  /** Six floats per segment, matching `positions`. */
  colors: Float32Array
  /**
   * Eight floats per segment: the band inputs (vertexBandInputs) of its start, then of its end. Route lines carry
   * it (useLineLayer then draws them with the band offset); other line layers leave it out.
   */
  bands?: Float32Array
  /**
   * Per path, the buffer segment of each of its segments (i joins points i and i + 1), or -1 where it is left out
   * (under its primary), so a layer can rewrite one shape's per-segment attributes.
   */
  segments?: ReadonlyMap<ShapeId, Int32Array>
}

/**
 * The band offset's inputs at each point, four floats per point: its miter normal (right of travel) scaled by its
 * length factor 1 / cosHalf (mx, mz), its band slot and its corridor's half-width in slots (corridors.ts). The map
 * lines (via buildLineBuffers) and the trains (trackPoint.ts) both read these, so they shift alike. A polyline
 * with no direction (all points equal) has no normal: its miters stay 0 and it is drawn unshifted.
 */
export function vertexBandInputs(points: readonly Ground[], band: readonly number[], half: readonly number[]): Float32Array {
  const out = new Float32Array(points.length * BAND_INPUTS)
  const miters = miterNormals(points)
  points.forEach((_, i) => {
    const m = miters?.[i]
    const o = i * BAND_INPUTS
    if (m) {
      out[o] = m.x / m.cosHalf
      out[o + 1] = m.z / m.cosHalf
    }
    out[o + 2] = band[i]!
    out[o + 3] = half[i]!
  })
  return out
}

/**
 * Flattens shape paths into LineSegments2 buffers. Segments draw in buffer order, so the order
 * is the overlap rule: non-primary shapes first, then by route order, then by id; the last
 * one drawn wins where tracks are shared. `colorOf` must return linear RGB (three.js Color).
 * With `skipCovered`, a variant's segments that draw exactly under its primary (ShapePath.cover) are left out
 * when that primary is among `paths`: it draws the same pixels after them. Only for opaque layers; on a
 * translucent one the variant would show through.
 */
export function buildLineBuffers(
  paths: readonly ShapePath[],
  routeOrder: ReadonlyMap<RouteId, number>,
  colorOf: (routeId: RouteId) => Rgb,
  skipCovered = false,
): Required<LineBuffers> {
  const rank = (p: ShapePath) => routeOrder.get(p.routeId) ?? Infinity
  const sorted = [...paths].sort(
    (a, b) =>
      Number(a.primary) - Number(b.primary) || rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const ids = new Set(paths.map((p) => p.id))
  const skipOf = (p: ShapePath) => (skipCovered && p.cover && ids.has(p.cover.primaryId) ? p.cover.segments : null)
  let count = 0
  for (const p of sorted) {
    const skip = skipOf(p)
    for (let i = 1; i < p.points.length; i++) if (!skip?.[i - 1]) count++
  }
  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 6)
  const bands = new Float32Array(count * 2 * BAND_INPUTS)
  const segments = new Map<ShapeId, Int32Array>()
  let seg = 0
  for (const path of sorted) {
    const [r, g, b] = colorOf(path.routeId)
    const skip = skipOf(path)
    const of = new Int32Array(Math.max(path.points.length - 1, 0)).fill(-1)
    segments.set(path.id, of)
    for (let i = 1; i < path.points.length; i++) {
      if (skip?.[i - 1]) continue
      const a = path.points[i - 1]!
      const c = path.points[i]!
      positions.set([a.x, path.y[i - 1]!, a.z, c.x, path.y[i]!, c.z], seg * 6)
      colors.set([r, g, b, r, g, b], seg * 6)
      // A segment's two ends are consecutive points, so their inputs are contiguous.
      bands.set(path.bandInputs.subarray((i - 1) * BAND_INPUTS, (i + 1) * BAND_INPUTS), seg * 2 * BAND_INPUTS)
      of[i - 1] = seg++
    }
  }
  return { positions, colors, bands, segments }
}
