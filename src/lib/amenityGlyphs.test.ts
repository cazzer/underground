import { describe, expect, it } from 'vitest'
import { AMENITY_ORDER, GLYPHS, amenityKinds, groupAmenities, type GlyphPiece } from './amenityGlyphs'

const EPS = 1e-9

function xRange(piece: GlyphPiece): [number, number] {
  const xs = piece.map(([x]) => x)
  return [Math.min(...xs), Math.max(...xs)]
}

function yRange(piece: GlyphPiece): [number, number] {
  const ys = piece.map(([, y]) => y)
  return [Math.min(...ys), Math.max(...ys)]
}

describe('GLYPHS', () => {
  for (const kind of AMENITY_ORDER) {
    const pieces = GLYPHS[kind]

    it(`${kind}: every piece is a convex counter-clockwise polygon inside [-1, 1]`, () => {
      expect(pieces.length).toBeGreaterThan(0)
      for (const piece of pieces) {
        expect(piece.length).toBeGreaterThanOrEqual(3)
        const at = (i: number) => piece[i % piece.length] ?? [NaN, NaN]
        for (let i = 0; i < piece.length; i++) {
          const [ax, ay] = at(i)
          const [bx, by] = at(i + 1)
          const [cx, cy] = at(i + 2)
          expect(Math.abs(ax)).toBeLessThanOrEqual(1)
          expect(Math.abs(ay)).toBeLessThanOrEqual(1)
          // Every turn is to the left: convex and counter-clockwise.
          expect((bx - ax) * (cy - by) - (by - ay) * (cx - bx)).toBeGreaterThan(EPS)
        }
      }
    })

    it(`${kind}: pieces sharing some x run far to near (a later piece lies wholly below an earlier one)`, () => {
      pieces.forEach((far, i) => {
        pieces.slice(i + 1).forEach((near) => {
          const [ai, bi] = xRange(far)
          const [aj, bj] = xRange(near)
          if (Math.min(bi, bj) - Math.max(ai, aj) <= EPS) return
          expect(yRange(near)[1]).toBeLessThanOrEqual(yRange(far)[0] + EPS)
        })
      })
    })
  }
})

describe('amenityKinds', () => {
  it('lists the kinds in order, a restroom by presence only', () => {
    expect(amenityKinds(undefined)).toEqual([])
    expect(amenityKinds({})).toEqual([])
    expect(amenityKinds({ restrooms: 2 })).toEqual(['restroom'])
    expect(amenityKinds({ restrooms: 0 })).toEqual([])
    expect(amenityKinds({ csc: { entrance: 'Enter at 14 St and 4 Av' } })).toEqual(['csc'])
    expect(amenityKinds({ csc: { entrance: 'x' }, restrooms: 1 })).toEqual(['restroom', 'csc'])
  })
})

describe('groupAmenities', () => {
  it('takes the union over the members and the first entrance', () => {
    const stations = { A: { restrooms: 1 }, B: { csc: { entrance: 'Enter at B' } }, C: { csc: { entrance: 'Enter at C' } } }
    expect(groupAmenities(stations, ['A', 'B', 'C'])).toEqual({ kinds: ['restroom', 'csc'], cscEntrance: 'Enter at B' })
    expect(groupAmenities(stations, ['C', 'B'])).toEqual({ kinds: ['csc'], cscEntrance: 'Enter at C' })
  })

  it('is empty for members with no entry, inherited keys included', () => {
    expect(groupAmenities({}, ['Z', 'toString'])).toEqual({ kinds: [], cscEntrance: null })
  })
})
