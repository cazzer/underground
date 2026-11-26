import { describe, expect, it } from 'vitest'
import { resolveNavigation } from './config'

describe('resolveNavigation', () => {
  it('is off with no param', () => {
    expect(resolveNavigation('')).toBe(false)
    expect(resolveNavigation('?lines=b')).toBe(false)
  })

  it('turns on for 1, on and true', () => {
    expect(resolveNavigation('?nav=1')).toBe(true)
    expect(resolveNavigation('?nav=on')).toBe(true)
    expect(resolveNavigation('?lines=b&nav=true')).toBe(true)
  })

  it('stays off for other values', () => {
    expect(resolveNavigation('?nav=0')).toBe(false)
    expect(resolveNavigation('?nav=off')).toBe(false)
    expect(resolveNavigation('?nav')).toBe(false)
  })
})
