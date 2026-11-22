/**
 * Segment writer shared by the interior geometry modules.
 * Type-only imports with .ts paths: scripts/lib/stationOutputs.test.ts (nodenext) loads this file.
 */
import type { LocalPoint } from '../data/stationSchema.ts'

export type Rgb = readonly [number, number, number]

/**
 * Strong strokes: outline, track, stair, escalator, elevator, entrance. Fine strokes: step, guide, fare,
 * and the lighter parts of escalators and elevators (handrails, cabs).
 * `outage` takes the place of `escalator` or `elevator` on a machine that is out of service, strong and fine alike.
 */
export type InteriorRole =
  | 'outline'
  | 'track'
  | 'stair'
  | 'escalator'
  | 'elevator'
  | 'entrance'
  | 'step'
  | 'guide'
  | 'fare'
  | 'outage'
export type Vec3 = readonly [number, number, number]

/** lineBuffers.ts's LineBuffers (not imported: that module has extensionless imports) plus dash distances. */
export interface Buffers {
  /** Six floats per segment: start xyz, end xyz, group-local meters. */
  positions: Float32Array
  /** Six floats per segment, matching `positions`. */
  colors: Float32Array
  /**
   * Two floats per segment: the dash distance at its start and end, meters. A dashed segment runs 0 to its length,
   * so every edge starts on a dash and none falls wholly into a gap; a solid one is 0, 0, so a dashed material never
   * cuts it. Read only when the layer's material is dashed.
   */
  distances: Float32Array
}

/** Where connector strokes are written: a SegmentWriter, or a SplitAtY over two of them. */
export interface SegmentSink {
  segment(a: Vec3, b: Vec3, ca: Rgb, cb?: Rgb, dashed?: boolean): void
  loop(points: readonly LocalPoint[], y: number, c: Rgb, dashed?: boolean): void
}

export class SegmentWriter implements SegmentSink {
  readonly positions: number[] = []
  readonly colors: number[] = []
  readonly distances: number[] = []

  segment(a: Vec3, b: Vec3, ca: Rgb, cb: Rgb = ca, dashed = false): void {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    this.colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2])
    this.distances.push(0, dashed ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) : 0)
  }

  /** Closed loop through `points` at height y: one segment per point. */
  loop(points: readonly LocalPoint[], y: number, c: Rgb, dashed = false): void {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const q = points[(i + 1) % points.length]!
      this.segment([p[0], y, p[1]], [q[0], y, q[1]], c, c, dashed)
    }
  }

  polyline(points: readonly LocalPoint[], y: number, c: Rgb): void {
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1]!
      const q = points[i]!
      this.segment([p[0], y, p[1]], [q[0], y, q[1]], c)
    }
  }

  build(): Buffers {
    return {
      positions: new Float32Array(this.positions),
      colors: new Float32Array(this.colors),
      distances: new Float32Array(this.distances),
    }
  }
}

/**
 * Writes the part of each segment at or below `y` to `below` and the rest to `above`, cutting a segment that crosses
 * it there (colors interpolated). Only solid connector strokes go through it today; a dashed caller's two parts would
 * each restart on a dash (the phase isn't carried across the cut).
 */
export class SplitAtY implements SegmentSink {
  private readonly below: SegmentWriter
  private readonly above: SegmentWriter
  private readonly y: number

  constructor(below: SegmentWriter, above: SegmentWriter, y: number) {
    this.below = below
    this.above = above
    this.y = y
  }

  segment(a: Vec3, b: Vec3, ca: Rgb, cb: Rgb = ca, dashed = false): void {
    const { y } = this
    if (a[1] <= y && b[1] <= y) return this.below.segment(a, b, ca, cb, dashed)
    if (a[1] >= y && b[1] >= y) return this.above.segment(a, b, ca, cb, dashed)
    const t = (y - a[1]) / (b[1] - a[1])
    const m: Vec3 = [lerp(a[0], b[0], t), y, lerp(a[2], b[2], t)]
    const cm = lerpRgb(ca, cb, t)
    const [lo, hi] = a[1] < y ? [this.below, this.above] : [this.above, this.below]
    lo.segment(a, m, ca, cm, dashed)
    hi.segment(m, b, cm, cb, dashed)
  }

  loop(points: readonly LocalPoint[], y: number, c: Rgb, dashed = false): void {
    const sink = y <= this.y ? this.below : this.above
    sink.loop(points, y, c, dashed)
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
