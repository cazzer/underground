import { describe, expect, it } from 'vitest'
import { interiorFreeRect } from './interiorCamera'
import {
  REVEAL_FEATHER_SHARE,
  REVEAL_MAX_STEP_MS,
  advanceClock,
  easeOutCubic,
  fadeOpacity,
  revealFront,
  revealGeometry,
  revealGradient,
  revealProgress,
} from './mapReveal'

function farthestCorner(w: number, h: number, cx: number, cy: number): number {
  let best = 0
  const corners: [number, number][] = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ]
  for (const [x, y] of corners) best = Math.max(best, Math.hypot(x - cx, y - cy))
  return best
}

const free = (w: number, h: number, top: number, bottom: number) =>
  interiorFreeRect({ width: w, height: h }, { top, bottom }, null)

describe('revealGeometry', () => {
  it('centres on the free area between the insets when there is no panel', () => {
    const g = revealGeometry(390, 844, free(390, 844, 120, 40))
    expect(g.cx).toBe(195)
    expect(g.cy).toBe(462)
  })

  it('centres above a phone panel', () => {
    const panel = { left: 0, top: 500, right: 390, bottom: 804 }
    const g = revealGeometry(390, 844, interiorFreeRect({ width: 390, height: 844 }, { top: 120, bottom: 40 }, panel))
    expect(g.cx).toBe(195)
    expect(g.cy).toBe((120 + 484) / 2)
  })

  it('centres left of a desktop side panel', () => {
    const panel = { left: 1040, top: 100, right: 1424, bottom: 860 }
    const g = revealGeometry(1440, 900, interiorFreeRect({ width: 1440, height: 900 }, { top: 60, bottom: 20 }, panel))
    expect(g.cx).toBe((1040 - 16) / 2)
    expect(g.cy).toBe(60 + (880 - 60) / 2)
  })

  it('clamps a free area with no height to its top', () => {
    const g = revealGeometry(390, 300, free(390, 300, 200, 200))
    expect(g.cy).toBe(200)
  })

  it('has the farthest corner as its radius, and a feather share of it', () => {
    const cases: [number, number, number, number][] = [
      [390, 844, 120, 40],
      [1440, 900, 0, 0],
      [800, 600, 300, 10],
      [320, 480, 500, 500],
    ]
    for (const [w, h, top, bottom] of cases) {
      const g = revealGeometry(w, h, free(w, h, top, bottom))
      expect(g.radius).toBeCloseTo(farthestCorner(w, h, g.cx, g.cy), 9)
      expect(g.feather).toBeCloseTo(REVEAL_FEATHER_SHARE * g.radius, 9)
    }
  })
})

describe('advanceClock', () => {
  it('adds the frame gap, capped at the step limit', () => {
    expect(advanceClock(100, 1000, 1016)).toBe(116)
    expect(advanceClock(100, 1000, 1500)).toBe(100 + REVEAL_MAX_STEP_MS)
  })

  it('never runs backward', () => {
    expect(advanceClock(100, 1000, 990)).toBe(100)
  })
})

describe('revealFront', () => {
  const g = revealGeometry(390, 844, free(390, 844, 120, 40))

  it('starts closed and ends clear of every corner', () => {
    expect(revealFront(g, 0)).toEqual({ inner: 0, outer: 0 })
    expect(revealFront(g, 1).inner).toBeGreaterThanOrEqual(g.radius)
  })

  it('grows monotonically with a non-negative inner edge and a fixed feather once open', () => {
    let prev = -1
    for (let i = 0; i <= 100; i++) {
      const f = revealFront(g, i / 100)
      expect(f.outer).toBeGreaterThanOrEqual(prev)
      expect(f.inner).toBeGreaterThanOrEqual(0)
      if (f.outer >= g.feather) expect(f.outer - f.inner).toBeCloseTo(g.feather, 9)
      prev = f.outer
    }
  })
})

describe('easing and progress', () => {
  it('has fixed ends, is monotone, and is ahead of linear at the middle', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
    let prev = 0
    for (let i = 1; i <= 50; i++) {
      const e = easeOutCubic(i / 50)
      expect(e).toBeGreaterThanOrEqual(prev)
      prev = e
    }
  })

  it('clamps progress and treats a zero duration as done', () => {
    expect(revealProgress(-5, 1000)).toBe(0)
    expect(revealProgress(500, 1000)).toBe(0.5)
    expect(revealProgress(5000, 1000)).toBe(1)
    expect(revealProgress(0, 0)).toBe(1)
    expect(revealProgress(10, -1)).toBe(1)
  })
})

describe('fadeOpacity', () => {
  it('falls linearly from 1 to 0 over 200 ms', () => {
    expect(fadeOpacity(0)).toBe(1)
    expect(fadeOpacity(100)).toBe(0.5)
    expect(fadeOpacity(200)).toBe(0)
    expect(fadeOpacity(900)).toBe(0)
  })
})

describe('revealGradient', () => {
  it('names the centre and orders the stops inner then outer', () => {
    const g = revealGeometry(390, 844, free(390, 844, 120, 40))
    const css = revealGradient(g, { inner: 10, outer: 50 }, '#123456')
    expect(css).toContain('circle at 195px 462px')
    expect(css.indexOf('transparent 10px')).toBeGreaterThan(-1)
    expect(css.indexOf('#123456 50px')).toBeGreaterThan(css.indexOf('transparent 10px'))
  })
})
