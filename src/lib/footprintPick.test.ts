import { describe, expect, it } from 'vitest'
import { footprintAt, insideFootprint, insidePolygon } from './footprintPick'
import type { Footprint } from './interiorFootprint'
import type { ToScreen } from './pick'
import { DEPTH_FLOOR } from './tilt'

/** 2 px per meter; a tilted view draws a point `tilt` px lower per meter below the street. */
const view = (tilt = 0): ToScreen => (x, y, z, out) => {
  out.x = x * 2
  out.y = z * 2 - y * tilt
  return true
}
/** As `view`, but anything deeper than 15 m is behind the camera. */
const shallowCamera: ToScreen = (x, y, z, out) => view(4)(x, y, z, out) && y > -15

/** A 20 m square around (100, 100), 20 m deep: on screen (top-down) 180..220 px both ways. */
const square = (originX = 100, originZ = 100): Footprint => ({
  originX,
  originZ,
  hull: [
    [-10, -10],
    [10, -10],
    [10, 10],
    [-10, 10],
  ],
  yLow: -20,
  yHigh: 0,
})

const at = (x: number, y: number) => ({ x, y })
const all = () => true

describe('insidePolygon', () => {
  const xs = [0, 10, 10, 0]
  const ys = [0, 0, 10, 10]

  it('tells inside from outside a square', () => {
    expect(insidePolygon(5, 5, xs, ys, 4)).toBe(true)
    expect(insidePolygon(15, 5, xs, ys, 4)).toBe(false)
    expect(insidePolygon(5, -1, xs, ys, 4)).toBe(false)
  })

  it('follows a concave outline', () => {
    // An L: the square's top-right quarter cut out.
    const lx = [0, 10, 10, 5, 5, 0]
    const ly = [0, 0, 5, 5, 10, 10]
    expect(insidePolygon(2, 8, lx, ly, 6)).toBe(true)
    expect(insidePolygon(8, 8, lx, ly, 6)).toBe(false)
  })

  it("counts a point level with a vertex once", () => {
    const dx = [0, 10, 0, -10]
    const dy = [-10, 0, 10, 0]
    expect(insidePolygon(0, 0, dx, dy, 4)).toBe(true)
    expect(insidePolygon(-12, 0, dx, dy, 4)).toBe(false)
    expect(insidePolygon(12, 0, dx, dy, 4)).toBe(false)
  })

  it('reads the polygon from an offset', () => {
    expect(insidePolygon(5, 5, [99, ...xs], [99, ...ys], 4, 1)).toBe(true)
  })
})

describe('insideFootprint', () => {
  it('top-down, holds the hull and nothing past it', () => {
    expect(insideFootprint(square(), 1, view(), at(200, 200))).toBe(true)
    expect(insideFootprint(square(), 1, view(), at(219, 181))).toBe(true)
    // 7 m past the hull's south edge.
    expect(insideFootprint(square(), 1, view(), at(200, 234))).toBe(false)
  })

  it('tilted, holds the sides between the street ring and the deepest one, and nothing beyond', () => {
    // At 4 px per meter of depth the bottom ring is 80 px lower (260..300): only the sides cover 220..260.
    expect(insideFootprint(square(), 1, view(4), at(200, 240))).toBe(true)
    expect(insideFootprint(square(), 1, view(4), at(200, 280))).toBe(true)
    expect(insideFootprint(square(), 1, view(4), at(200, 310))).toBe(false)
    expect(insideFootprint(square(), 1, view(4), at(230, 240))).toBe(false)
  })

  it('draws the depth at the depth scale: at the floor it is the top-down footprint', () => {
    expect(insideFootprint(square(), 0.25, view(4), at(200, 250))).toBe(false)
    expect(insideFootprint(square(), DEPTH_FLOOR, view(4), at(200, 240))).toBe(false)
    expect(insideFootprint(square(), DEPTH_FLOOR, view(4), at(200, 200))).toBe(true)
  })

  it('misses when any vertex is behind the camera', () => {
    expect(insideFootprint(square(), 1, shallowCamera, at(200, 200))).toBe(false)
  })
})

describe('footprintAt', () => {
  const focusedAndNeighbour = [square(100, 100), square(115, 100)]

  it('gives the focused footprint for a click inside it, even where a neighbour overlaps', () => {
    expect(footprintAt(focusedAndNeighbour, all, 0, 1, view(), at(215, 200))).toBe(0)
  })

  it('gives the neighbour with no focused footprint, or outside the focused one', () => {
    expect(footprintAt(focusedAndNeighbour, all, -1, 1, view(), at(218, 200))).toBe(1)
    expect(footprintAt(focusedAndNeighbour, all, 0, 1, view(), at(245, 200))).toBe(1)
  })

  it('picks the overlapping neighbour whose origin is nearer the click', () => {
    expect(footprintAt(focusedAndNeighbour, all, -1, 1, view(), at(212, 200))).toBe(0)
    expect(footprintAt(focusedAndNeighbour, all, -1, 1, view(), at(218, 200))).toBe(1)
  })

  it('skips footprints that are not visible, the focused one included', () => {
    expect(footprintAt(focusedAndNeighbour, (i) => i !== 1, -1, 1, view(), at(245, 200))).toBe(-1)
    expect(footprintAt(focusedAndNeighbour, (i) => i !== 0, 0, 1, view(), at(215, 200))).toBe(1)
    expect(footprintAt(focusedAndNeighbour, all, 0, 1, view(), at(400, 400))).toBe(-1)
  })
})
