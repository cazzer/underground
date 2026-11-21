/**
 * Segment writer shared by the interior geometry modules.
 * Type-only imports with .ts paths: scripts/lib/interiorRegistry.test.ts (nodenext) loads this file.
 */
import type { LocalPoint } from '../data/stationSchema.ts'

export type Rgb = readonly [number, number, number]

/**
 * Strong strokes: outline, track, stair, escalator, elevator, entrance. Fine strokes: step, guide, fare,
 * and the lighter parts of escalators and elevators (handrails, cabs).
 */
export type InteriorRole = 'outline' | 'track' | 'stair' | 'escalator' | 'elevator' | 'entrance' | 'step' | 'guide' | 'fare'
export type Vec3 = readonly [number, number, number]

/** Same shape as lineBuffers.ts's LineBuffers (not imported: that module has extensionless imports). */
export interface Buffers {
  /** Six floats per segment: start xyz, end xyz, group-local meters. */
  positions: Float32Array
  /** Six floats per segment, matching `positions`. */
  colors: Float32Array
}

export class SegmentWriter {
  readonly positions: number[] = []
  readonly colors: number[] = []

  segment(a: Vec3, b: Vec3, ca: Rgb, cb: Rgb = ca): void {
    this.positions.push(a[0], a[1], a[2], b[0], b[1], b[2])
    this.colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2])
  }

  /** Closed loop through `points` at height y: one segment per point. */
  loop(points: readonly LocalPoint[], y: number, c: Rgb): void {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      const q = points[(i + 1) % points.length]!
      this.segment([p[0], y, p[1]], [q[0], y, q[1]], c)
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
    return { positions: new Float32Array(this.positions), colors: new Float32Array(this.colors) }
  }
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const lerpRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]
