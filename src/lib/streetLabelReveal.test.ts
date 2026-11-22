import { describe, expect, it } from 'vitest'
import { LABELS_FROM_DEPTH, LABELS_FULL_DEPTH } from './interiorReveal'
import { DESKTOP_LABEL_RADIUS_M, PHONE_LABEL_RADIUS_M, streetLabelOpacity, streetLabelRadiusM } from './streetLabelReveal'

describe('streetLabelOpacity', () => {
  it('stays hidden while the view is a flat plan, whatever the reveal', () => {
    expect(streetLabelOpacity(1, 0)).toBe(0)
    expect(streetLabelOpacity(1, LABELS_FROM_DEPTH)).toBe(0)
  })

  it('reaches the layer opacity by the full label depth', () => {
    expect(streetLabelOpacity(1, LABELS_FULL_DEPTH)).toBe(1)
    expect(streetLabelOpacity(0.4, 1)).toBeCloseTo(0.4)
    expect(streetLabelOpacity(0, 1)).toBe(0)
  })

  it('rises monotonically in between', () => {
    const mid = (LABELS_FROM_DEPTH + LABELS_FULL_DEPTH) / 2
    const a = streetLabelOpacity(1, (LABELS_FROM_DEPTH + mid) / 2)
    const b = streetLabelOpacity(1, mid)
    expect(a).toBeGreaterThan(0)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(1)
  })
})

describe('streetLabelRadiusM', () => {
  it('labels a tighter circle on a phone', () => {
    expect(streetLabelRadiusM({ width: 390, height: 844 })).toBe(PHONE_LABEL_RADIUS_M)
    expect(streetLabelRadiusM({ width: 844, height: 390 })).toBe(PHONE_LABEL_RADIUS_M)
    expect(streetLabelRadiusM({ width: 1440, height: 900 })).toBe(DESKTOP_LABEL_RADIUS_M)
  })
})
