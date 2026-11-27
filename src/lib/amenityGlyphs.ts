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

const HEAD_Y = 0.7
const HEAD_R = 0.2
/** The torso's and the dress's top: a 0.2 neck under the heads, so the two don't merge when the map tilts them. */
const BODY_TOP = 0.3
const LEG_TOP = -0.45

/**
 * Each glyph's pieces, far to near: wherever two pieces share some x, the later one lies wholly below the earlier
 * (so a flat glyph drawn with y as depth paints right in this order; enp.5 extrudes these pieces).
 * Restroom: a man (rectangle torso over a narrower block of legs) and a woman (a dress widening down over a block
 * of legs), side by side; the legs are one block each, since a gap between them smears at 16 px.
 * Customer service: an "i" (square dot, stem with a serif, wide foot), the dot 0.3 clear of the stem.
 * Every feature and gap is at least about 0.2 units, so the extruded marks (enp.5) still read apart when tilted.
 */
export const GLYPHS: Record<AmenityKind, readonly GlyphPiece[]> = {
  restroom: [
    octagon(-0.5, HEAD_Y, HEAD_R),
    octagon(0.5, HEAD_Y, HEAD_R),
    rect(-0.8, -0.2, -0.2, BODY_TOP),
    [[0.12, LEG_TOP], [0.88, LEG_TOP], [0.66, BODY_TOP], [0.34, BODY_TOP]],
    rect(-0.7, -0.92, -0.3, -0.2),
    rect(0.32, -0.92, 0.68, LEG_TOP),
  ],
  csc: [
    rect(-0.2, 0.55, 0.2, 0.92),
    rect(-0.2, -0.62, 0.2, 0.25),
    rect(-0.48, 0, -0.2, 0.25),
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
