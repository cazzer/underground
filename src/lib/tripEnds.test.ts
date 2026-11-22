import { describe, expect, it } from 'vitest'
import { isTripEnd } from './tripEnds'

describe('isTripEnd', () => {
  it('is true for either end itself', () => {
    expect(isTripEnd('L08', [], { from: 'L08', to: 'G29' })).toBe(true)
    expect(isTripEnd('G29', [], { from: 'L08', to: 'G29' })).toBe(true)
  })

  it('is true for another member of an end complex', () => {
    expect(isTripEnd('L03', ['635', 'R20'], { from: '637', to: '635' })).toBe(true)
    expect(isTripEnd('R20', ['635', 'L03'], { from: 'L03', to: null })).toBe(true)
  })

  it('is false for a station that is neither end nor shares a complex with one', () => {
    expect(isTripEnd('L08', [], { from: '637', to: '635' })).toBe(false)
    expect(isTripEnd('L03', ['635', 'R20'], { from: null, to: null })).toBe(false)
  })
})
