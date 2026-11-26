import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { GlyphPiece } from '../lib/amenityGlyphs'
import { PLATE_HALF } from './amenitySizes'

/** A glyph's extrusion height in glyph units (its half width is 1), before the depth factor flattens it. */
export const AMENITY_HEIGHT = 0.14
/** A plate corner's chamfer, in glyph units. */
const PLATE_CHAMFER = 0.3

/** Glyph (x right, y up = far) to local (x east, z = -y), at height h. */
function put(out: number[], [x, y]: readonly [number, number], h: number): void {
  out.push(x, h, -y)
}

/**
 * A glyph's pieces as one prism geometry in local units: each piece's top cap (a fan, facing up) and its side walls
 * (facing out), no bottom (it lies on the ground), written in piece order so a nearer piece paints over a farther one
 * with depth testing off (the glyph is yawed to face the camera, amenityGlyphs' far-to-near order). The `color`
 * attribute is 1 on the tops and `sideShade` (a linear multiplier) on the walls; the instance color multiplies it.
 */
export function glyphGeometry(pieces: readonly GlyphPiece[], sideShade: number): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const shade = (v: number, n: number) => {
    for (let i = 0; i < n; i++) col.push(v, v, v)
  }
  for (const piece of pieces) {
    for (let i = 0; i < piece.length; i++) {
      const a = piece[i]!
      const b = piece[(i + 1) % piece.length]!
      // Counter-clockwise in glyph units, so (a0, b0, b1) and (a0, b1, a1) face outward.
      put(pos, a, 0)
      put(pos, b, 0)
      put(pos, b, AMENITY_HEIGHT)
      put(pos, a, 0)
      put(pos, b, AMENITY_HEIGHT)
      put(pos, a, AMENITY_HEIGHT)
      shade(sideShade, 6)
    }
    for (let i = 1; i + 1 < piece.length; i++) {
      put(pos, piece[0]!, AMENITY_HEIGHT)
      put(pos, piece[i]!, AMENITY_HEIGHT)
      put(pos, piece[i + 1]!, AMENITY_HEIGHT)
      shade(1, 3)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new Float32BufferAttribute(col, 3))
  return g
}

/** The plate under a glyph: a flat chamfered square of half size PLATE_HALF (glyph units) facing up, at y 0. */
export function plateGeometry(): BufferGeometry {
  const h = PLATE_HALF
  const c = PLATE_CHAMFER
  const ring: [number, number][] = [
    [-h + c, -h],
    [h - c, -h],
    [h, -h + c],
    [h, h - c],
    [h - c, h],
    [-h + c, h],
    [-h, h - c],
    [-h, -h + c],
  ]
  const pos: number[] = []
  for (let i = 1; i + 1 < ring.length; i++) {
    put(pos, ring[0]!, 0)
    put(pos, ring[i]!, 0)
    put(pos, ring[i + 1]!, 0)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  return g
}
