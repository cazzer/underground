import { describe, expect, it } from 'vitest'
import { DEFAULT_TILT, depthFactor } from './tilt'
import { interiorOpacity, labelOpacity, LABELS_FROM_DEPTH, LABELS_FULL_DEPTH, REVEAL_FAR, REVEAL_NEAR, veilWeight } from './interiorReveal'

describe('interiorOpacity', () => {
  it('is hidden at and beyond the far distance', () => {
    expect(REVEAL_FAR).toBe(1100)
    expect(interiorOpacity(1100)).toBe(0)
    expect(interiorOpacity(3000)).toBe(0)
  })

  it('is fully shown from the full-tilt distance in', () => {
    expect(REVEAL_NEAR).toBe(800)
    for (const d of [800, 400, 40, 0]) expect(interiorOpacity(d)).toBe(1)
  })

  it('is half at the log midpoint', () => {
    expect(interiorOpacity(Math.sqrt(800 * 1100))).toBeCloseTo(0.5)
  })

  it('decreases strictly across the fade', () => {
    const values = [820, 880, 940, 1000, 1080].map(interiorOpacity)
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
  it('the plan is fully in while the camera is still nearly top-down, so the levels separate afterwards', () => {
    expect(interiorOpacity(REVEAL_NEAR)).toBe(1)
    expect(depthFactor(REVEAL_NEAR)).toBeLessThan(0.45)
    expect(depthFactor(REVEAL_FAR)).toBeLessThan(0.06)
  })

  it('depth and the reveal are both full at the landing distance', () => {
    const landing = DEFAULT_TILT.nearDistance
    expect(landing).toBe(400)
    expect(depthFactor(landing)).toBe(1)
    expect(interiorOpacity(landing)).toBe(1)
  })
})
