import type { LineBuffers, Rgb } from './lineBuffers'
import type { ShapePath } from './network'
import { MASK_INSET_M, maskSpanWeight, type StationSpans } from './platformSpan'

/** Vertex spacing along each end ramp, so the color eases rather than steps. */
const RAMP_STEP_M = 2

/** Distances to place mask vertices at along [d0, d1], sorted: both ends, every RAMP_STEP_M through each ramp, the path's own vertices. */
function maskDistances(path: ShapePath, d0: number, d1: number): number[] {
  const out = [d0, d1]
  const inside = (d: number) => d > d0 && d < d1
  for (let d = d0 + RAMP_STEP_M; d < d0 + MASK_INSET_M; d += RAMP_STEP_M) out.push(d, d1 - (d - d0))
  out.push(d0 + MASK_INSET_M, d1 - MASK_INSET_M, ...path.cumulative)
  const sorted = out.filter((d) => d === d0 || d === d1 || inside(d)).sort((a, b) => a - b)
  return sorted.filter((d, i) => i === 0 || d > sorted[i - 1]!)
}

/**
 * The map track along each shape's platform span, as LineSegments2 buffers to draw over the map lines. Vertices
 * lie on the drawn line (linear between its vertices, height included, as the line draws), and each is colored
 * from the line's own color (`colorOf`, at the platform ends) to `background` (inside) by maskSpanWeight, so,
 * drawn opaque, the mask erases the map track along the platform and blends back into it at both ends. Colors
 * are linear RGB. Shapes without a span are skipped.
 */
export function platformMaskBuffers(
  paths: readonly ShapePath[],
  spans: StationSpans,
  colorOf: (path: ShapePath) => Rgb,
  background: Rgb,
): LineBuffers {
  const positions: number[] = []
  const colors: number[] = []
  for (const path of paths) {
    const span = spans.get(path.id)
    if (!span || path.points.length < 2) continue
    const d0 = Math.max(span.d0, 0)
    const d1 = Math.min(span.d1, path.length)
    if (!(d1 > d0)) continue
    const line = colorOf(path)
    let seg = 1
    let prev: number[] | null = null
    for (const d of maskDistances(path, d0, d1)) {
      while (seg < path.points.length - 1 && path.cumulative[seg]! < d) seg++
      const from = path.cumulative[seg - 1]!
      const len = path.cumulative[seg]! - from
      const t = len > 0 ? Math.min(Math.max((d - from) / len, 0), 1) : 0
      const a = path.points[seg - 1]!
      const b = path.points[seg]!
      const w = maskSpanWeight(d, span)
      const vertex = [
        a.x + (b.x - a.x) * t,
        path.y[seg - 1]! + (path.y[seg]! - path.y[seg - 1]!) * t,
        a.z + (b.z - a.z) * t,
        line[0] + (background[0] - line[0]) * w,
        line[1] + (background[1] - line[1]) * w,
        line[2] + (background[2] - line[2]) * w,
      ]
      if (prev) {
        positions.push(prev[0]!, prev[1]!, prev[2]!, vertex[0]!, vertex[1]!, vertex[2]!)
        colors.push(prev[3]!, prev[4]!, prev[5]!, vertex[3]!, vertex[4]!, vertex[5]!)
      }
      prev = vertex
    }
  }
  return { positions: Float32Array.from(positions), colors: Float32Array.from(colors) }
}
