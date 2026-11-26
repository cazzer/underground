import type { StationAmenities } from '../data/amenitiesSchema'

/** The amenities a station can show: a public restroom (presence only) and a staffed 24/7 customer service center. */
export type AmenityKind = 'restroom' | 'csc'

/** The order glyphs and words appear in. */
export const AMENITY_ORDER: readonly AmenityKind[] = ['restroom', 'csc']

/** A point in glyph units: x right, y up, inside [-1, 1]. */
export type GlyphPoint = readonly [number, number]
/** One convex piece of a glyph, counter-clockwise. */
export type GlyphPiece = readonly GlyphPoint[]

const rect = (x0: number, y0: number, x1: number, y1: number): GlyphPiece => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]

/** A regular octagon with flat sides facing the axes (a head). */
function octagon(cx: number, cy: number, r: number): GlyphPiece {
  return Array.from({ length: 8 }, (_, k): GlyphPoint => {
    const a = Math.PI / 8 + (k * Math.PI) / 4
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  })
}

const HEAD_Y = 0.66
const HEAD_R = 0.22
const LEG_TOP = -0.45

/**
 * Each glyph's pieces, far to near: wherever two pieces share some x, the later one lies wholly below the earlier
 * (so a flat glyph drawn with y as depth paints right in this order; enp.5 extrudes these pieces).
 * Restroom: a man (rectangle torso, two legs) and a woman (a dress widening down, two legs), side by side.
 * Customer service: an "i" (square dot, stem with a serif, wide foot).
 */
export const GLYPHS: Record<AmenityKind, readonly GlyphPiece[]> = {
  restroom: [
    octagon(-0.5, HEAD_Y, HEAD_R),
    octagon(0.5, HEAD_Y, HEAD_R),
    rect(-0.8, -0.2, -0.2, 0.34),
    [[0.12, LEG_TOP], [0.88, LEG_TOP], [0.66, 0.34], [0.34, 0.34]],
    rect(-0.76, -0.92, -0.56, -0.2),
    rect(-0.44, -0.92, -0.24, -0.2),
    rect(0.3, -0.92, 0.44, LEG_TOP),
    rect(0.56, -0.92, 0.7, LEG_TOP),
  ],
  csc: [
    rect(-0.2, 0.5, 0.2, 0.9),
    rect(-0.2, -0.62, 0.2, 0.3),
    rect(-0.48, 0.06, -0.2, 0.3),
    rect(-0.48, -0.9, 0.48, -0.62),
  ],
}

/** The kinds an entry has, in AMENITY_ORDER. */
export function amenityKinds(entry: StationAmenities | undefined): AmenityKind[] {
  if (!entry) return []
  return AMENITY_ORDER.filter((kind) => (kind === 'restroom' ? (entry.restrooms ?? 0) > 0 : entry.csc !== undefined))
}

export interface GroupAmenities {
  kinds: AmenityKind[]
  /** The customer service center's entrance text (the MTA page's "Enter at …"), from the first member that has one. */
  cscEntrance: string | null
}

/** A complex's amenities: the union over its members (the file lists every member the same, so this is belt and braces). */
export function groupAmenities(stations: Readonly<Record<string, StationAmenities>>, memberIds: readonly string[]): GroupAmenities {
  const have = new Set<AmenityKind>()
  let cscEntrance: string | null = null
  for (const id of memberIds) {
    const entry = Object.hasOwn(stations, id) ? stations[id] : undefined
    for (const kind of amenityKinds(entry)) have.add(kind)
    cscEntrance ??= entry?.csc?.entrance ?? null
  }
  return { kinds: AMENITY_ORDER.filter((kind) => have.has(kind)), cscEntrance }
}
