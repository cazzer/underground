import { describe, expect, it } from 'vitest'
import type { Direction } from '../data/schema'
import { NO_BANDS } from './corridors'
import { vertexBandInputs } from './lineBuffers'
import type { ShapePath } from './network'
import { EMPTY_PROFILE } from './trackProfile'
import { coverVariants, primaryCover } from './variantCover'

interface PathOptions {
  primary?: boolean
  routeId?: string
  direction?: Direction
  y?: number[]
  slot?: number[]
}

function path(id: string, xz: [number, number][], o: PathOptions = {}): ShapePath {
  const points = xz.map(([x, z]) => ({ x, z }))
  const cumulative = points.map(() => 0)
  for (let i = 1; i < points.length; i++) {
    cumulative[i] = cumulative[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z)
  }
  return {
    id,
    routeId: o.routeId ?? 'A',
    direction: o.direction ?? 'N',
    primary: o.primary ?? false,
    points,
    cumulative,
    length: cumulative.at(-1)!,
    y: o.y ?? points.map(() => 0),
    profile: EMPTY_PROFILE,
    bandInputs: vertexBandInputs(points, o.slot ?? points.map(() => 0), points.map(() => 1)),
    bands: NO_BANDS,
  }
}

const EAST: [number, number][] = [[0, 0], [100, 0], [200, 0], [300, 0], [400, 0]]
const primary = path('p', EAST, { primary: true })

describe('primaryCover', () => {
  it('covers the shared segments, up to the last vertex whose miter still matches', () => {
    // Shares the primary to x = 300, then turns south: vertex 3's miter turns too, so segment 2 draws apart.
    const v = path('v', [...EAST.slice(0, 4), [300, 100]])
    expect([...primaryCover(v, primary, [])!.segments]).toEqual([1, 1, 0, 0])
  })

  it('covers a variant that starts and ends at primary vertices only where the miters match', () => {
    // A short turn from x = 100 to 300: its end vertices' miters are its own segment normals, the primary's too (straight).
    const v = path('v', EAST.slice(1, 4))
    expect(primaryCover(v, primary, [])).toEqual({ primaryId: 'p', segments: Uint8Array.of(1, 1) })
  })

  it('draws a segment whose band slot, height or vertices differ', () => {
    expect(primaryCover(path('v', EAST, { slot: [0, 0, 1, 1, 1] }), primary, [])!.segments).toEqual(Uint8Array.of(1, 0, 0, 0))
    expect(primaryCover(path('v', EAST, { y: [0, 0, 0, -0.01, -0.01] }), primary, [])!.segments).toEqual(Uint8Array.of(1, 1, 0, 0))
    // An extra vertex at x = 150: its two halves match no primary segment.
    const split = path('v', [[0, 0], [100, 0], [150, 0], [200, 0], [300, 0], [400, 0]])
    expect([...primaryCover(split, primary, [])!.segments]).toEqual([1, 0, 0, 1, 1])
  })

  it('draws a variant running the other way along the same points', () => {
    expect(primaryCover(path('v', [...EAST].reverse()), primary, [])).toBeNull()
  })

  it("draws segments inside the primary's platform spans (the fade turns it translucent there)", () => {
    // The variant starts at x = 100, so the primary's span at 300 to 350 is the variant's last segment.
    expect([...primaryCover(path('v', EAST.slice(1)), primary, [{ d0: 300, d1: 350 }])!.segments]).toEqual([1, 1, 0])
    // A span ending or starting at a segment's end has a weight of 0 along it.
    expect([...primaryCover(path('v', EAST), primary, [{ d0: 100, d1: 200 }])!.segments]).toEqual([1, 0, 1, 1])
  })
})

describe('coverVariants', () => {
  it("covers each variant against its own route and direction's primary only", () => {
    const shapes = [
      primary,
      path('same', EAST),
      path('south', EAST, { direction: 'S' }),
      path('other', EAST, { routeId: 'C' }),
      path('C-p', [[0, 50], [100, 50]], { routeId: 'C', primary: true }),
    ]
    const out = coverVariants(shapes, new Map())
    expect(out.map((s) => s.cover?.primaryId)).toEqual([undefined, 'p', undefined, undefined, undefined])
    // Shapes without a cover are passed through as they are.
    expect(out.filter((s, i) => s === shapes[i]).map((s) => s.id)).toEqual(['p', 'south', 'other', 'C-p'])
  })

  it("reads the primary's spans at every station, and not the variant's", () => {
    const spans = new Map([
      ['S1', new Map([['p', { d0: 10, d1: 20 }]])],
      ['S2', new Map([['p', { d0: 310, d1: 320 }], ['same', { d0: 110, d1: 120 }]])],
    ])
    expect([...coverVariants([primary, path('same', EAST)], spans)[1]!.cover!.segments]).toEqual([0, 1, 1, 0])
  })
})
