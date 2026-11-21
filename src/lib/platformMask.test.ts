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
  const xs = [0, 100, ...maskBreaks({ d0: 160, d1: 240 }).flatMap((d) => (d === 160 ? [160, 164] : [d])), 300, 400]
  const a = path('a', xs)
  const b = path('b', [0, 400])
  const first = new Map([
    ['b', 0],
    ['a', 1],
  ])
  const fade = new Float32Array((1 + xs.length - 1) * FADE_INPUTS).fill(9)

  it('weighs each segment end of the span shapes, and zeroes every other segment', () => {
    writePlatformFade(fade, [a, b], first, new Map([['a', { d0: 160, d1: 240 }]]))
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

  it('clears everything for no station', () => {
    writePlatformFade(fade, [a, b], first, null)
    expect([...fade].every((v) => v === 0)).toBe(true)
  })
})
