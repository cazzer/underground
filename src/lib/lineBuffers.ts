import type { RouteId } from '../data/schema'
import type { ShapePath } from './network'

export type Rgb = readonly [number, number, number]

export interface LineBuffers {
  /** Six floats per segment: start xyz, end xyz (y = 0). */
  positions: Float32Array
  /** Six floats per segment, matching `positions`. */
  colors: Float32Array
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
): LineBuffers {
  const rank = (p: ShapePath) => routeOrder.get(p.routeId) ?? Infinity
  const sorted = [...paths].sort(
    (a, b) =>
      Number(a.primary) - Number(b.primary) || rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const segments = sorted.reduce((n, p) => n + Math.max(p.points.length - 1, 0), 0)
  const positions = new Float32Array(segments * 6)
  const colors = new Float32Array(segments * 6)
  let o = 0
  for (const path of sorted) {
    const [r, g, b] = colorOf(path.routeId)
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1]!
      const c = path.points[i]!
      positions.set([a.x, 0, a.z, c.x, 0, c.z], o)
      colors.set([r, g, b, r, g, b], o)
      o += 6
    }
  }
  return { positions, colors }
}
