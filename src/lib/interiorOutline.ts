/** Points along a station interior's platform and slab outlines, for the street names to keep clear of on screen.
 *  Pure. */
import type { StationInterior } from '../data/stationSchema'

/** The most points one interior gives; a larger interior is sampled more sparsely. */
export const MAX_OUTLINE_SAMPLES = 256
/** Spacing along an outline, meters, before MAX_OUTLINE_SAMPLES stretches it. */
export const OUTLINE_SAMPLE_M = 4

/**
 * Every `OUTLINE_SAMPLE_M` (or more, to stay within `max`) along each platform and slab outline, closed, at its
 * level's y × `yScale`, and along each slab outline again at the street (y 0): x, y, z triples in the interior's
 * local meters, at most `max` of them.
 */
export function outlineSamples(interior: StationInterior, yScale: number, max = MAX_OUTLINE_SAMPLES): Float32Array {
  const levelY = new Map(interior.levels.map((l) => [l.id, l.y * yScale]))
  // Slabs also draw a street-level copy of their outline (the street reference), so they are walked twice.
  const rings = [
    ...[...interior.platforms, ...interior.slabs].map((o) => ({ y: levelY.get(o.level) ?? 0, points: o.outline })),
    ...interior.slabs.map((o) => ({ y: 0, points: o.outline })),
  ]
  let perimeter = 0
  for (const r of rings) {
    for (let i = 0; i < r.points.length; i++) {
      const a = r.points[i]!
      const b = r.points[(i + 1) % r.points.length]!
      perimeter += Math.hypot(b[0] - a[0], b[1] - a[1])
    }
  }
  const step = Math.max(OUTLINE_SAMPLE_M, perimeter / max)
  const out: number[] = []
  for (const r of rings) {
    // Carry the leftover distance across edges so the spacing stays even round each ring.
    let next = 0
    for (let i = 0; i < r.points.length; i++) {
      const a = r.points[i]!
      const b = r.points[(i + 1) % r.points.length]!
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      for (; next < len; next += step) {
        if (out.length / 3 >= max) return Float32Array.from(out)
        const t = len > 0 ? next / len : 0
        out.push(a[0] + (b[0] - a[0]) * t, r.y, a[1] + (b[1] - a[1]) * t)
      }
      next -= len
    }
  }
  return Float32Array.from(out)
}
