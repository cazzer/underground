/**
 * The amenity marks' per-frame state and writers (StationAmenities.tsx): where each mark lies, which tier draws it and
 * how far it has mixed toward the background, written into the instanced meshes' arrays. Allocation-free once built.
 */
import { AMENITY_ORDER, type AmenityKind } from '../lib/amenityGlyphs'
import { markCentre, plateReach, type AmenityMark } from '../lib/amenityPlacement'
import { dimLineRgbInto, type Rgb3 } from '../lib/lineDim'
import { writeChordMatrix, writeInstanceMatrix } from '../lib/markerMatrices'
import type { Presence } from '../lib/presence'
import type { MarkSizes } from './amenitySizes'

/** Lift off the ground, meters (depth testing is off, so these only nudge the projection): plate, then glyph. */
const PLATE_Y = 0.25
const GLYPH_Y = 0.3

/** The tier a copy draws in: under the veil with the street layers, or over it beside an interior's own marks. */
export const TIERS = ['under', 'over'] as const
export type Tier = (typeof TIERS)[number]

/** One layout's marks and their frame state. */
export interface AmenityFrame {
  marks: readonly AmenityMark[]
  /** Per kind, the mark index of each of that kind's glyph instances. */
  byKind: Record<AmenityKind, Int32Array>
  /** Per mark, its glyph instance within its kind's mesh. */
  slot: Int32Array
  /** Per mark, the shown interior covering its station (its presence), or null. */
  cover: (Presence | null)[]
  /** Per mark, how far that interior's hull (plus the focus frame's extra pad) reaches along its bearing, meters. */
  reach: Float32Array
  /** Per mark, the presence its matrices and colors were last written at (NaN: rewrite). */
  drawnP: Float32Array
  /** Per mark, its centre on the ground, as last written. */
  x: Float32Array
  z: Float32Array
  /** The view the matrices were last written for. */
  last: { d: number; az: number; depth: number; trip: boolean }
}

export function newAmenityFrame(marks: readonly AmenityMark[]): AmenityFrame {
  const byKind = {} as Record<AmenityKind, Int32Array>
  const slot = new Int32Array(marks.length)
  for (const kind of AMENITY_ORDER) {
    const idx: number[] = []
    marks.forEach((m, i) => {
      if (m.kind !== kind) return
      slot[i] = idx.length
      idx.push(i)
    })
    byKind[kind] = Int32Array.from(idx)
  }
  return {
    marks,
    byKind,
    slot,
    cover: marks.map(() => null),
    reach: new Float32Array(marks.length),
    drawnP: new Float32Array(marks.length).fill(NaN),
    x: new Float32Array(marks.length),
    z: new Float32Array(marks.length),
    last: { d: NaN, az: NaN, depth: NaN, trip: false },
  }
}

/** The arrays one tier writes: its plates' matrices and, per kind, its glyphs' matrices and instance colors. */
export interface TierArrays {
  plate: Float32Array
  glyph: Record<AmenityKind, Float32Array>
  color: Record<AmenityKind, Float32Array>
}

/** A mark's presence now: its covering interior's, else 0 (bare). */
export const presenceOf = (f: AmenityFrame, i: number): number => f.cover[i]?.value ?? 0

/**
 * Says whether anything a mark draws from changed since the last write: the view (distance, azimuth, depth, the trip's
 * marks) or a covering interior's presence.
 */
export function frameChanged(f: AmenityFrame, d: number, az: number, depth: number, trip: boolean): boolean {
  const l = f.last
  if (d !== l.d || az !== l.az || depth !== l.depth || trip !== l.trip) return true
  for (let i = 0; i < f.marks.length; i++) if (presenceOf(f, i) !== f.drawnP[i]) return true
  return false
}

/**
 * Writes every mark's matrices in both tiers (yawed by the camera azimuth `az`, so the glyph's up runs up the screen;
 * its height × `depth`), and the instance colors of any mark whose presence changed: the under copy mixes toward the
 * background by the presence, the over copy by 1 − presence, and a copy fully mixed collapses to scale 0 (plate too).
 * A covered mark slides out from the marker's clearance to the interior's hull reach as the presence eases in; the row
 * spaces its plates by how far each, yawed, reaches along the bearing, so no corner crosses the marker.
 * Returns whether any color was written.
 */
export function writeAmenityFrame(
  f: AmenityFrame,
  tiers: Record<Tier, TierArrays>,
  sizes: MarkSizes,
  d: number,
  az: number,
  depth: number,
  trip: boolean,
  mark: Rgb3 | Float32Array,
  background: Rgb3,
  rgb: Float32Array,
): boolean {
  const l = f.last
  l.d = d
  l.az = az
  l.depth = depth
  l.trip = trip
  const ux = Math.sin(az)
  const uz = Math.cos(az)
  const s = sizes.glyph
  const sy = s * depth
  let colored = false
  for (let i = 0; i < f.marks.length; i++) {
    const m = f.marks[i]!
    const p = presenceOf(f, i)
    const clear = f.cover[i] ? sizes.clear + (Math.max(f.reach[i]!, sizes.clear) - sizes.clear) * p : sizes.clear
    const along = markCentre(m.k, clear, plateReach(sizes.plate, m.dir, az), sizes.gap)
    const x = m.pos.x + m.dir.x * along
    const z = m.pos.z + m.dir.z * along
    f.x[i] = x
    f.z[i] = z
    const j = f.slot[i]!
    for (let ti = 0; ti < TIERS.length; ti++) {
      const amount = ti === 0 ? p : 1 - p
      const t = tiers[TIERS[ti]!]
      const glyph = t.glyph[m.kind]
      if (amount >= 1) {
        writeInstanceMatrix(t.plate, i, x, PLATE_Y, z, 0)
        writeInstanceMatrix(glyph, j, x, GLYPH_Y, z, 0)
      } else {
        writeChordMatrix(t.plate, i, x, PLATE_Y, z, ux, 0, uz, s, 1, s)
        writeChordMatrix(glyph, j, x, GLYPH_Y, z, ux, 0, uz, s, sy, s)
      }
      if (p !== f.drawnP[i]) {
        t.color[m.kind].set(dimLineRgbInto(rgb, mark, background, amount), j * 3)
        colored = true
      }
    }
    f.drawnP[i] = p
  }
  return colored
}
