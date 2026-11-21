import { describe, expect, it } from 'vitest'
import { mixHex, routeLineColor } from './routeColor'

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

describe('routeLineColor', () => {
  it('mixes the route color toward the rule color by its amount', () => {
    expect(routeLineColor('#0062CF', { toward: '#ffffff', amount: 0 })).toBe('#0062cf')
    expect(routeLineColor('#0062CF', { toward: '#33ff66', amount: 1 })).toBe('#33ff66')
    expect(routeLineColor('#000000', { toward: '#ffffff', amount: 0.3 })).toBe('#4d4d4d')
  })
})
