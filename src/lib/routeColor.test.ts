import { describe, expect, it } from 'vitest'
import { contrastRatio, MIN_LINE_CONTRAST, mixHex, relativeLuminance, routeLineColor } from './routeColor'

describe('mixHex', () => {
  it('returns the first color at t = 0 and the second at t = 1', () => {
    expect(mixHex('#0062cf', '#ffffff', 0)).toBe('#0062cf')
    expect(mixHex('#0062cf', '#ffffff', 1)).toBe('#ffffff')
  })

  it('blends to the midpoint at t = 0.5', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mixHex('#ff0000', '#0000ff', 0.5)).toBe('#800080')
  })

  it('accepts uppercase hex and returns lowercase #rrggbb', () => {
    expect(mixHex('#0062CF', '#FFFFFF', 0)).toBe('#0062cf')
  })

  it('rejects malformed colors', () => {
    expect(() => mixHex('#fff', '#ffffff', 0)).toThrow(/#fff/)
  })
})

const BLUEPRINT = { background: '#0b2147', mix: { toward: '#ffffff', amount: 0.3 } }
const DRAFTING = { background: '#f3efe4', mix: { toward: '#2b2b2b', amount: 0.15 } }

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for a color on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrastRatio('#0b2147', '#0b2147')).toBe(1)
  })
})

describe('routeLineColor', () => {
  it('returns the plain mix when it already has enough contrast', () => {
    expect(routeLineColor('#0062CF', { toward: '#ffffff', amount: 0 }, '#000000', 1)).toBe('#0062cf')
    expect(routeLineColor('#0062CF', { toward: '#33ff66', amount: 1 }, '#000000')).toBe('#33ff66')
    expect(routeLineColor('#000000', { toward: '#ffffff', amount: 0.3 }, '#000000', 1)).toBe('#4d4d4d')
  })

  it('lifts blueprint SIR (#08179C) to 3:1 on navy', () => {
    const mixed = mixHex('#08179C', '#ffffff', 0.3)
    expect(contrastRatio(mixed, BLUEPRINT.background)).toBeLessThan(MIN_LINE_CONTRAST)
    const c = routeLineColor('#08179C', BLUEPRINT.mix, BLUEPRINT.background)
    expect(contrastRatio(c, BLUEPRINT.background)).toBeGreaterThanOrEqual(MIN_LINE_CONTRAST)
  })

  it('darkens drafting N/Q/R/W yellow (#F6BC26) to 3:1 on paper', () => {
    const c = routeLineColor('#F6BC26', DRAFTING.mix, DRAFTING.background)
    expect(contrastRatio(c, DRAFTING.background)).toBeGreaterThanOrEqual(MIN_LINE_CONTRAST)
    expect(relativeLuminance(c)).toBeLessThan(relativeLuminance('#F6BC26'))
  })

  it('pushes away from the background when the rule color would not help', () => {
    const c = routeLineColor('#0b2147', { toward: '#0b2147', amount: 1 }, '#0b2147')
    expect(contrastRatio(c, '#0b2147')).toBeGreaterThanOrEqual(MIN_LINE_CONTRAST)
    expect(relativeLuminance(c)).toBeGreaterThan(relativeLuminance('#0b2147'))
  })
})
