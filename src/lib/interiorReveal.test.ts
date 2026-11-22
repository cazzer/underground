import { describe, expect, it } from 'vitest'
import { ENTER_DISTANCE } from './focusMachine'
import { DEFAULT_TILT, depthFactor, tiltForDistance } from './tilt'
import { interiorOpacity, labelOpacity, LABELS_FROM_DEPTH, LABELS_FULL_DEPTH, REVEAL_FAR, REVEAL_NEAR, veilWeight } from './interiorReveal'

describe('interiorOpacity', () => {
  it('is hidden at and beyond the far distance', () => {
    expect(REVEAL_FAR).toBe(1250)
    expect(interiorOpacity(1250)).toBe(0)
    expect(interiorOpacity(3000)).toBe(0)
  })

  it('is fully shown from the near distance in', () => {
    expect(REVEAL_NEAR).toBe(1000)
    for (const d of [1000, 800, 400, 40, 0]) expect(interiorOpacity(d)).toBe(1)
  })

  it('is half at the log midpoint', () => {
    expect(interiorOpacity(Math.sqrt(1000 * 1250))).toBeCloseTo(0.5)
  })

  it('decreases strictly across the fade', () => {
    const values = [1010, 1060, 1120, 1180, 1240].map(interiorOpacity)
    for (let i = 1; i < values.length; i++) expect(values[i]!).toBeLessThan(values[i - 1]!)
  })

  it('never returns NaN', () => {
    for (const d of [Number.NaN, Infinity, -1]) expect(Number.isNaN(interiorOpacity(d))).toBe(false)
  })
})

describe('veilWeight', () => {
  it('is the opacity at full depth and nothing while the interior lies flat', () => {
    expect(veilWeight(1, 1)).toBe(1)
    expect(veilWeight(0.4, 1)).toBe(0.4)
    expect(veilWeight(1, 0)).toBe(0)
    expect(veilWeight(0.5, 0.5)).toBe(0.25)
  })
})

describe('labelOpacity', () => {
  it('hides the labels until the levels separate, then follows the opacity', () => {
    expect(labelOpacity(1, 0)).toBe(0)
    expect(labelOpacity(1, LABELS_FROM_DEPTH)).toBe(0)
    expect(labelOpacity(1, (LABELS_FROM_DEPTH + LABELS_FULL_DEPTH) / 2)).toBeCloseTo(0.5, 9)
    expect(labelOpacity(1, LABELS_FULL_DEPTH)).toBe(1)
    expect(labelOpacity(0.3, 1)).toBeCloseTo(0.3, 9)
    expect(labelOpacity(0, 1)).toBe(0)
  })
})

describe('stage invariants', () => {
  /** On-screen gap (px on an 844 px tall phone, fov 35) between two levels 10 m apart (drawn x2) at distance d. */
  const levelGapPx = (d: number) => {
    const viewHeightM = 2 * d * Math.tan((17.5 * Math.PI) / 180)
    return ((20 * depthFactor(d) * Math.sin(tiltForDistance(d))) / viewHeightM) * 844
  }

  it('the plan fades in from where the tilt first shows and is fully in while its levels are still a few px apart', () => {
    expect(REVEAL_FAR).toBe(ENTER_DISTANCE)
    expect(levelGapPx(REVEAL_FAR)).toBeLessThan(1)
    expect(interiorOpacity(REVEAL_NEAR)).toBe(1)
    expect(levelGapPx(REVEAL_NEAR)).toBeLessThan(6)
    expect(levelGapPx(DEFAULT_TILT.nearDistance)).toBeGreaterThan(30)
  })

  it('names the levels only once they have begun to separate', () => {
    expect(depthFactor(REVEAL_FAR)).toBeLessThan(LABELS_FROM_DEPTH)
  })

  it('depth and the reveal are both full at the landing distance', () => {
    const landing = DEFAULT_TILT.nearDistance
    expect(landing).toBe(400)
    expect(depthFactor(landing)).toBe(1)
    expect(interiorOpacity(landing)).toBe(1)
  })
})
