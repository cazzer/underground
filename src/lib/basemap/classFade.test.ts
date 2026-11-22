import { describe, expect, it } from 'vitest'
import { DEFAULT_TILT } from '../tilt'
import { BASEMAP_CLASSES } from './featureClass'
import { CLASS_FADE, classVisibility } from './classFade'

describe('classVisibility', () => {
  it('is full inside `full` and at its floor beyond `gone`', () => {
    for (const cls of BASEMAP_CLASSES) {
      const { full, gone, floor } = CLASS_FADE[cls]
      expect(classVisibility(cls, full * 0.5), cls).toBe(1)
      expect(classVisibility(cls, full), cls).toBe(1)
      expect(classVisibility(cls, gone), cls).toBe(floor)
      expect(classVisibility(cls, gone * 3), cls).toBe(floor)
    }
  })

  it('falls monotonically between, halfway at the log-distance midpoint', () => {
    for (const cls of BASEMAP_CLASSES) {
      const { full, gone, floor } = CLASS_FADE[cls]
      let prev = 1
      for (let i = 0; i <= 40; i++) {
        const v = classVisibility(cls, full * (gone / full) ** (i / 40))
        expect(v, `${cls} step ${i}`).toBeLessThanOrEqual(prev + 1e-12)
        prev = v
      }
      expect(classVisibility(cls, Math.sqrt(full * gone))).toBeCloseTo((1 + floor) / 2, 12)
    }
  })

  it('keeps water at 0.6, half the parks and half the highways at the city view, and no street grid', () => {
    const city = 80_000
    expect(classVisibility('water', city)).toBe(0.6)
    expect(classVisibility('park', city)).toBe(0.5)
    expect(classVisibility('highway', city)).toBe(0.5)
    expect(classVisibility('major', city)).toBe(0)
    expect(classVisibility('minor', city)).toBe(0)
    expect(classVisibility('path', city)).toBe(0)
  })

  it('has every class in by the time the view starts to tip', () => {
    for (const cls of BASEMAP_CLASSES) expect(classVisibility(cls, DEFAULT_TILT.farDistance), cls).toBe(1)
  })
})
