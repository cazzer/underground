import { describe, expect, it } from 'vitest'
import { NO_BANDS } from './corridors'
import type { ShapePath } from './network'
import { FADE_INPUTS, maskBreaks, writePlatformFade } from './platformMask'
import { MASK_INSET_M } from './platformSpan'
import { EMPTY_PROFILE } from './trackProfile'

/** A straight east-running path with vertices at `xs` (its distances). */
function path(id: string, xs: number[]): ShapePath {
  return {
    id,
    routeId: 'L',
    direction: 'N',
    primary: true,
    points: xs.map((x) => ({ x, z: 5 })),
    cumulative: xs,
    length: xs.at(-1)!,
    y: xs.map(() => 0),
    profile: EMPTY_PROFILE,
    bandInputs: new Float32Array(xs.length * 4),
    bands: NO_BANDS,
  }
}

describe('maskBreaks', () => {
  it('puts a vertex at both span ends and at the inner end of each ramp', () => {
    expect(maskBreaks({ d0: 160, d1: 240 })).toEqual([160, 170, 230, 240])
  })

  it('stays inside a span shorter than two ramps', () => {
    const b = maskBreaks({ d0: 100, d1: 108 })
    expect(Math.min(...b)).toBe(100)
    expect(Math.max(...b)).toBe(108)
  })
})

describe('writePlatformFade', () => {
  // 164: an extra line vertex inside the fade (e.g. a ramp break), to check the weight between the mask's own breaks.
  const xs = [0, 100, ...maskBreaks({ d0: 160, d1: 240 }).flatMap((d) => (d === 160 ? [160, 164] : [d])), 300, 400]
  const a = path('a', xs)
  const b = path('b', [0, 400])
  // b's one segment first, then a's.
  const first = new Map([
    ['b', Int32Array.of(0)],
    ['a', Int32Array.from(xs.slice(1), (_, i) => 1 + i)],
  ])
  const fade = new Float32Array((1 + xs.length - 1) * FADE_INPUTS).fill(9)

  it('weighs each segment end of the span shapes, and zeroes every other segment', () => {
    writePlatformFade(fade, [a, b], first, new Map([['a', [{ d0: 160, d1: 240 }]]]))
    const weightAt = (d: number) => {
      const i = xs.indexOf(d)
      return fade[(1 + i - 1) * FADE_INPUTS + 1]!
    }
    expect([fade[0], fade[1]]).toEqual([0, 0])
    expect(weightAt(100)).toBe(0)
    expect(weightAt(160)).toBe(0)
    expect(weightAt(160 + MASK_INSET_M)).toBe(1)
    expect(weightAt(240 - MASK_INSET_M)).toBe(1)
    expect(weightAt(240)).toBe(0)
    // smoothstep(0.4), 4 m into the ramp.
    expect(weightAt(164)).toBeCloseTo(0.352, 6)
    // A segment's start repeats the previous segment's end, so the fade is continuous.
    for (let i = 2; i < xs.length; i++) expect(fade[(1 + i - 1) * FADE_INPUTS]).toBe(fade[(1 + i - 2) * FADE_INPUTS + 1])
  })

  it('skips segments left out of the buffers', () => {
    // b drawn second, after a's first segment; a's second segment is left out (-1).
    const c = path('c', [100, 200, 300])
    const out = new Float32Array(3 * FADE_INPUTS).fill(9)
    writePlatformFade(out, [c, b], new Map([['c', Int32Array.of(0, -1)], ['b', Int32Array.of(1)]]), new Map([['c', [{ d0: 0, d1: 400 }]]]))
    expect([...out]).toEqual([1, 1, 0, 0, 0, 0])
  })

  it('fades two stations on one shape and keeps the track between them', () => {
    // Points at both stations' fade breaks plus one midway; one buffer segment per pair of points.
    const at = [...maskBreaks({ d0: 0, d1: 150 }), 500, ...maskBreaks({ d0: 900, d1: 1050 })]
    const d = path('d', at)
    const out = new Float32Array((at.length - 1) * FADE_INPUTS)
    const spans = new Map([['d', [{ d0: 0, d1: 150 }, { d0: 900, d1: 1050 }]]])
    writePlatformFade(out, [d], new Map([['d', Int32Array.from(at.slice(1), (_, i) => i)]]), spans)
    const endWeight = (x: number) => out[(at.indexOf(x) - 1) * FADE_INPUTS + 1]
    expect(endWeight(MASK_INSET_M)).toBe(1)
    expect(endWeight(900 + MASK_INSET_M)).toBe(1)
    expect(endWeight(500)).toBe(0)
  })

  it('clears everything for no station', () => {
    writePlatformFade(fade, [a, b], first, null)
    expect([...fade].every((v) => v === 0)).toBe(true)
  })
})
