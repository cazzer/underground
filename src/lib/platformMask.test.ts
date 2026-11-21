import { describe, expect, it } from 'vitest'
import type { ShapePath } from './network'
import { platformMaskBuffers } from './platformMask'
import { MASK_INSET_M } from './platformSpan'
import { EMPTY_PROFILE } from './trackProfile'

/** A straight east-running path, 0..400 m, with a sunken stretch: y is -20 between 150 and 250 m. */
function path(id: string): ShapePath {
  const xs = [0, 100, 150, 250, 300, 400]
  const ys = [0, 0, -20, -20, 0, 0]
  return {
    id,
    routeId: 'L',
    direction: 'N',
    primary: true,
    points: xs.map((x) => ({ x, z: 5 })),
    cumulative: xs,
    length: 400,
    y: ys,
    profile: EMPTY_PROFILE,
  }
}

const LINE = [1, 0, 0] as const
const BG = [0, 0, 1] as const

describe('platformMaskBuffers', () => {
  const buffers = platformMaskBuffers([path('a'), path('b')], new Map([['a', { d0: 160, d1: 240 }]]), () => LINE, BG)
  const vertices = Array.from({ length: buffers.positions.length / 3 }, (_, v) => ({
    x: buffers.positions[v * 3]!,
    y: buffers.positions[v * 3 + 1]!,
    z: buffers.positions[v * 3 + 2]!,
    color: [buffers.colors[v * 3]!, buffers.colors[v * 3 + 1]!, buffers.colors[v * 3 + 2]!],
  }))

  it('covers exactly the span of the shapes that have one, as joined segments on the drawn line', () => {
    expect(Math.min(...vertices.map((v) => v.x))).toBeCloseTo(160, 4)
    expect(Math.max(...vertices.map((v) => v.x))).toBeCloseTo(240, 4)
    for (const v of vertices) {
      expect(v.z).toBe(5)
      expect(v.y).toBeCloseTo(-20, 4)
    }
    for (let s = 1; s < vertices.length / 2; s++) expect(vertices[2 * s]!.x).toBeCloseTo(vertices[2 * s - 1]!.x, 4)
  })

  it('is the line color at the platform ends and the background inside', () => {
    const at = (x: number) => vertices.find((v) => Math.abs(v.x - x) < 1e-3)!.color
    expect(at(160)).toEqual([...LINE])
    expect(at(240)).toEqual([...LINE])
    expect(at(160 + MASK_INSET_M)).toEqual([...BG])
    expect(at(240 - MASK_INSET_M)).toEqual([...BG])
    // Easing in between: smoothstep(0.4) of the way to the background, 4 m in.
    const mid = at(164)
    expect(mid[2]).toBeCloseTo(0.352, 6)
    expect(mid[0]).toBeCloseTo(0.648, 6)
  })

  it('follows the path height between vertices, and clamps a span to the path', () => {
    const ramp = platformMaskBuffers([path('a')], new Map([['a', { d0: -50, d1: 125 }]]), () => LINE, BG)
    const n = ramp.positions.length
    expect(ramp.positions[0]).toBe(0)
    expect(ramp.positions[n - 3]).toBeCloseTo(125, 4)
    expect(ramp.positions[n - 2]).toBeCloseTo(-10, 4)
  })
})
