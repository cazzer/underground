import { describe, expect, it } from 'vitest'
import { buildLineBuffers, type Rgb } from './lineBuffers'
import type { ShapePath } from './network'
import { NO_BANDS } from './corridors'
import { EMPTY_PROFILE } from './trackProfile'

function path(
  id: string,
  routeId: string,
  primary: boolean,
  points: [number, number][],
  y = points.map(() => 0),
  band = points.map(() => 0),
  bandHalf = points.map(() => 0),
): ShapePath {
  return {
    id,
    routeId,
    direction: 'N',
    primary,
    points: points.map(([x, z]) => ({ x, z })),
    cumulative: [],
    length: 0,
    y,
    profile: EMPTY_PROFILE,
    band,
    bandHalf,
    bands: NO_BANDS,
  }
}

const ORDER = new Map([
  ['A', 0],
  ['B', 1],
])
const COLORS: Record<string, Rgb> = { A: [1, 0, 0], B: [0, 0, 1] }
const colorOf = (id: string) => COLORS[id]!

/** First x of each segment, used as a segment label in the ordering test. */
function segmentStartsX(positions: Float32Array): number[] {
  const out: number[] = []
  for (let i = 0; i < positions.length; i += 6) out.push(positions[i]!)
  return out
}

describe('buildLineBuffers', () => {
  it('sizes both buffers at six floats per segment', () => {
    const { positions, colors } = buildLineBuffers(
      [path('a', 'A', true, [[0, 0], [1, 0], [2, 0]]), path('b', 'B', true, [[0, 0], [1, 1]])],
      ORDER,
      colorOf,
    )
    expect(positions.length).toBe(6 * 3)
    expect(colors.length).toBe(6 * 3)
  })

  it('writes consecutive points as segment endpoints at y = 0', () => {
    const { positions } = buildLineBuffers([path('a', 'A', true, [[0, 1], [2, 3], [4, 5]])], ORDER, colorOf)
    expect([...positions]).toEqual([0, 0, 1, 2, 0, 3, 2, 0, 3, 4, 0, 5])
  })

  it("takes each endpoint's height from the path's profile heights", () => {
    const { positions } = buildLineBuffers([path('a', 'A', true, [[0, 1], [2, 3], [4, 5]], [0, -6.5, -20.4])], ORDER, colorOf)
    expect([...positions]).toEqual([0, 0, 1, 2, -6.5, 3, 2, -6.5, 3, 4, -20.4, 5].map(Math.fround))
  })

  it('gives a two-point path one segment', () => {
    expect(buildLineBuffers([path('a', 'A', true, [[0, 0], [1, 0]])], ORDER, colorOf).positions.length).toBe(6)
  })

  it('orders non-primaries first, then route order, then id', () => {
    const { positions } = buildLineBuffers(
      [
        path('b1', 'B', true, [[10, 0], [0, 0]]),
        path('a2', 'A', true, [[21, 0], [0, 0]]),
        path('a1', 'A', true, [[20, 0], [0, 0]]),
        path('bx', 'B', false, [[30, 0], [0, 0]]),
        path('ax', 'A', false, [[40, 0], [0, 0]]),
      ],
      ORDER,
      colorOf,
    )
    expect(segmentStartsX(positions)).toEqual([40, 30, 20, 21, 10])
  })

  it("colors both ends of each segment with its route's color", () => {
    const { colors } = buildLineBuffers(
      [path('a', 'A', true, [[0, 0], [1, 0]]), path('b', 'B', true, [[0, 0], [1, 0]])],
      ORDER,
      colorOf,
    )
    expect([...colors]).toEqual([1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1])
  })

  it('writes the miter vector, band slot and half-width at both segment ends, eight floats per segment', () => {
    // East, then south: right of travel is south (+z), then west (-x); the corner's miter is the bisector, its
    // length the miter factor (sqrt 2 for a right angle), so (-1, 1).
    const { bands } = buildLineBuffers(
      [path('a', 'A', true, [[0, 0], [10, 0], [10, 10]], undefined, [1, 0.5, -1], [1, 1.5, 0.5])],
      ORDER,
      colorOf,
    )
    expect(bands.length).toBe(2 * 8)
    const expected = [0, 1, 1, 1, -1, 1, 0.5, 1.5, -1, 1, 0.5, 1.5, -1, 0, -1, 0.5]
    expected.forEach((v, i) => expect(bands[i]).toBeCloseTo(v, 6))
  })

  it('leaves the band inputs of a path with no direction at zero', () => {
    const { bands } = buildLineBuffers([path('a', 'A', true, [[3, 3], [3, 3]], undefined, [1, 1])], ORDER, colorOf)
    expect([...bands]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})
