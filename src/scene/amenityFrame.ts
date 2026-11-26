/**
 * The amenity marks' per-frame state and writers (StationAmenities.tsx): where each mark lies, which tier draws it and
 * how far it has mixed toward the background, written into the instanced meshes' arrays. Allocation-free once built.
 */
import { AMENITY_ORDER, type AmenityKind } from '../lib/amenityGlyphs'
import { rowCentreInto, type AmenityMark } from '../lib/amenityPlacement'
import { dimLineRgbInto, type Rgb3 } from '../lib/lineDim'
import { writeChordMatrix, writeInstanceMatrix } from '../lib/markerMatrices'
import type { Presence } from '../lib/presence'
import type { MarkSizes } from './amenitySizes'

/** Lift off the ground, meters (depth testing is off, so these only nudge the projection): plate, then glyph. */
const PLATE_Y = 0.25
const GLYPH_Y = 0.3

/** Scratch: a row's bearing and origin past an interior, and a mark's centre there (rowCentreInto takes Grounds). */
const cdir = { x: 0, z: 0 }
const corigin = { x: 0, z: 0 }
const bare = { x: 0, z: 0 }
const covered = { x: 0, z: 0 }

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
  /** Per covered mark, its row's origin and bearing past that interior (coveredRow) and how far the hull, plus the
   *  focus frame's extra pad, reaches along it from there, meters. */
  coverOX: Float32Array
  coverOZ: Float32Array
  coverX: Float32Array
  coverZ: Float32Array
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
  const n = marks.length
  return {
    marks,
    byKind,
    slot,
    cover: marks.map(() => null),
    coverOX: new Float32Array(n),
    coverOZ: new Float32Array(n),
    coverX: new Float32Array(n),
    coverZ: new Float32Array(n),
    reach: new Float32Array(n),
    drawnP: new Float32Array(n).fill(NaN),
    x: new Float32Array(n),
    z: new Float32Array(n),
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
 * How much of a tier's copy shows at presence `p`, 0..1: the under copy stays whole to half way and the over copy is
 * whole from half way, so mid blend one of the two is always at full ink and the mark never dims or blinks.
 */
export function tierShare(tier: number, p: number): number {
  return Math.min(Math.max(tier === 0 ? 2 * (1 - p) : 2 * p, 0), 1)
}

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
 * its height × `depth`) and the instance colors of any mark whose presence changed. Each tier's plate is scaled by
 * its share (tierShare) and its glyph mixed toward the background by the rest, a copy at share 0 collapsing to scale
 * 0, so the over copy's plate grows under its glyph rather than knocking out the under glyph at once. A row runs across the screen
 * (rowCentreInto); a covered mark slides from its row beside the marker to its row past the interior's hull
 * (coveredRow) as the presence eases in. Returns whether any color was written.
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
  let colored = false
  for (let i = 0; i < f.marks.length; i++) {
    const m = f.marks[i]!
    const p = presenceOf(f, i)
    rowCentreInto(bare, m.k, m.n, m.pos, m.dir, sizes.clear, sizes.plate, sizes.gap, az)
    let x = bare.x
    let z = bare.z
    if (p > 0) {
      cdir.x = f.coverX[i]!
      cdir.z = f.coverZ[i]!
      corigin.x = f.coverOX[i]!
      corigin.z = f.coverOZ[i]!
      rowCentreInto(covered, m.k, m.n, corigin, cdir, Math.max(f.reach[i]!, sizes.clear), sizes.plate, sizes.gap, az)
      x += (covered.x - x) * p
      z += (covered.z - z) * p
    }
    f.x[i] = x
    f.z[i] = z
    const j = f.slot[i]!
    for (let ti = 0; ti < TIERS.length; ti++) {
      const share = tierShare(ti, p)
      const t = tiers[TIERS[ti]!]
      const glyph = t.glyph[m.kind]
      if (share <= 0) {
        writeInstanceMatrix(t.plate, i, x, PLATE_Y, z, 0)
        writeInstanceMatrix(glyph, j, x, GLYPH_Y, z, 0)
      } else {
        writeChordMatrix(t.plate, i, x, PLATE_Y, z, ux, 0, uz, s * share, 1, s * share)
        writeChordMatrix(glyph, j, x, GLYPH_Y, z, ux, 0, uz, s, s * depth, s)
      }
      if (p !== f.drawnP[i]) {
        t.color[m.kind].set(dimLineRgbInto(rgb, mark, background, 1 - share), j * 3)
        colored = true
      }
    }
    f.drawnP[i] = p
  }
  return colored
}
