/**
 * The trip's dashed links (TripDashes.tsx, 2q7.45.4) as plain line buffers. Pure. A walk between two stations, or from
 * a station to a searched place, is its street path (`path`) in the walk color, else one segment between its ends; a ride the map can't find on a drawn shape (a `straight` span) is
 * the polyline through its stops in its route's color. Both at the ground (y 0), unbanded. Each polyline's dash
 * distances (world meters along it) restart at 0, so every link starts on a dash.
 */
import type { Rgb } from './lineBuffers'
import type { Ground } from './projection'
import type { RideStraightSpan, WalkSpan } from './tripSpans'

/** A walk's line: a transfer's (`WalkSpan`) or a place's (`PlaceWalkSpan`). */
export type WalkLine = Pick<WalkSpan, 'from' | 'to' | 'path'>

export interface TripDashBuffers {
  /** Six floats per segment: start xyz, end xyz. */
  positions: Float32Array
  /** Six floats per segment (linear RGB), matching `positions`. */
  colors: Float32Array
  /** Two floats per segment: the dash distance at its start and end. */
  distances: Float32Array
}

/**
 * Buffers for `walks` then `straights`, in that order. `colorOf` gives a straight ride's linear RGB, or null to leave
 * it out (a route the map has no color for).
 */
export function tripDashBuffers(
  walks: readonly WalkLine[],
  straights: readonly RideStraightSpan[],
  walkRgb: Rgb,
  colorOf: (span: RideStraightSpan) => Rgb | null,
): TripDashBuffers {
  const lines: { points: readonly Ground[]; color: Rgb }[] = walks.map((w) => ({ points: w.path ?? [w.from, w.to], color: walkRgb }))
  for (const s of straights) {
    const color = colorOf(s)
    if (color) lines.push({ points: s.points, color })
  }
  const count = lines.reduce((n, l) => n + Math.max(l.points.length - 1, 0), 0)
  const positions = new Float32Array(count * 6)
  const colors = new Float32Array(count * 6)
  const distances = new Float32Array(count * 2)
  let seg = 0
  for (const { points, color } of lines) {
    const [r, g, b] = color
    let along = 0
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!
      const c = points[i]!
      const length = Math.hypot(c.x - a.x, c.z - a.z)
      positions.set([a.x, 0, a.z, c.x, 0, c.z], seg * 6)
      colors.set([r, g, b, r, g, b], seg * 6)
      distances.set([along, along + length], seg * 2)
      along += length
      seg++
    }
  }
  return { positions, colors, distances }
}
