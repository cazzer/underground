/**
 * The trip's ride legs as band line buffers (TripLines.tsx). Pure. Each ride span (tripSpans.ts) redraws the whole
 * segments of its shape that overlap [d0, d1], with the same vertices, heights and band inputs as the map's own
 * layer (buildLineBuffers), so it lies exactly on its line and the trains ride it; a per-segment window (t0, t1) cuts
 * the first and last segment at the stops in the fragment shader. No line vertex is added (lineBreaks is untouched).
 */
import type { RouteId, ShapeId } from '../data/schema'
import { BAND_INPUTS, type LineBuffers, type Rgb } from './lineBuffers'
import type { ShapePath } from './network'
import type { RideShapeSpan } from './tripSpans'

/** What the map draws of the trip: the selected journey's ride spans; `faint` in the list view (no journey opened). */
export interface TripRouteDraw {
  /** The journey's `journeyKey`. */
  key: string
  rides: readonly RideShapeSpan[]
  faint: boolean
}

export type TripLineBuffers = Required<LineBuffers> & {
  /** Two floats per segment: the drawn stretch (t0, t1) of the segment, 0 at its start and 1 at its end. */
  windows: Float32Array
}

/**
 * The stretch of segment [a, b] (distances along its shape) inside [d0, d1], as fractions of the segment; null when
 * they don't overlap or only touch. A zero-length segment strictly inside is drawn whole.
 */
export function segmentWindow(a: number, b: number, d0: number, d1: number): [number, number] | null {
  if (b <= d0 || a >= d1) return null
  if (b === a) return [0, 1]
  return [Math.max(0, (d0 - a) / (b - a)), Math.min(1, (d1 - a) / (b - a))]
}

/**
 * Buffers for `rides`, in journey order, on `paths` (the drawn shapes: banded once the bands arrive, which the spans
 * must be computed on). `colorOf` gives linear RGB. `segments` maps each shape segment to the first ride's copy of it
 * (-1 for the rest), so the platform fade (usePlatformFade) applies there; a stretch two rides share fades on the
 * first only. Throws for a ride on a shape `paths` lacks.
 */
export function tripLineBuffers(paths: readonly ShapePath[], rides: readonly RideShapeSpan[], colorOf: (routeId: RouteId) => Rgb): TripLineBuffers {
  const byId = new Map(paths.map((p) => [p.id, p]))
  const pathOf = (ride: RideShapeSpan): ShapePath => {
    const path = byId.get(ride.shapeId)
    if (!path) throw new Error(`Trip ride leg ${ride.legIndex} draws on shape "${ride.shapeId}", which the map lacks`)
    return path
  }
  let count = 0
  for (const ride of rides) {
    const path = pathOf(ride)
    for (let i = 1; i < path.points.length; i++) {
      if (segmentWindow(path.cumulative[i - 1]!, path.cumulative[i]!, ride.d0, ride.d1)) count++
    }
  }
  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 6)
  const bands = new Float32Array(count * 2 * BAND_INPUTS)
  const windows = new Float32Array(count * 2)
  const segments = new Map<ShapeId, Int32Array>()
  let seg = 0
  for (const ride of rides) {
    const path = pathOf(ride)
    // The route's color, not the shape's: a leg found on another route's track ('other') still reads as its own line.
    const [r, g, b] = colorOf(ride.routeId)
    let of = segments.get(path.id)
    if (!of) {
      of = new Int32Array(Math.max(path.points.length - 1, 0)).fill(-1)
      segments.set(path.id, of)
    }
    for (let i = 1; i < path.points.length; i++) {
      const w = segmentWindow(path.cumulative[i - 1]!, path.cumulative[i]!, ride.d0, ride.d1)
      if (!w) continue
      const a = path.points[i - 1]!
      const c = path.points[i]!
      positions.set([a.x, path.y[i - 1]!, a.z, c.x, path.y[i]!, c.z], seg * 6)
      colors.set([r, g, b, r, g, b], seg * 6)
      bands.set(path.bandInputs.subarray((i - 1) * BAND_INPUTS, (i + 1) * BAND_INPUTS), seg * 2 * BAND_INPUTS)
      windows.set(w, seg * 2)
      if (of[i - 1] === -1) of[i - 1] = seg
      seg++
    }
  }
  return { positions, colors, bands, segments, windows }
}
