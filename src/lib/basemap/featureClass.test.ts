import { describe, expect, it } from 'vitest'
import { classOf } from './featureClass'

describe('classOf', () => {
  it('splits roads by kind', () => {
    expect(classOf('roads', 2, { kind: 'highway' })).toBe('highway')
    expect(classOf('roads', 2, { kind: 'major_road' })).toBe('major')
    expect(classOf('roads', 2, { kind: 'minor_road', kind_detail: 'service' })).toBe('minor')
    expect(classOf('roads', 2, { kind: 'path' })).toBe('path')
  })

  it('drops tunnels, rail, ferries, aerialways and aeroways', () => {
    expect(classOf('roads', 2, { kind: 'major_road', is_tunnel: true })).toBeNull()
    for (const kind of ['rail', 'ferry', 'aerialway', 'aeroway', 'other']) expect(classOf('roads', 2, { kind })).toBeNull()
  })

  it('keeps water areas and rivers, not pools or label lines', () => {
    expect(classOf('water', 3, { kind: 'ocean' })).toBe('water')
    expect(classOf('water', 3, { kind: 'water' })).toBe('water')
    expect(classOf('water', 2, { kind: 'river' })).toBe('water')
    expect(classOf('water', 3, { kind: 'swimming_pool' })).toBeNull()
    expect(classOf('water', 2, { kind: 'bay' })).toBeNull()
    expect(classOf('water', 1, { kind: 'water' })).toBeNull()
  })

  it('keeps park-like landuse areas only', () => {
    expect(classOf('landuse', 3, { kind: 'park' })).toBe('park')
    expect(classOf('landuse', 3, { kind: 'cemetery' })).toBe('park')
    expect(classOf('landuse', 3, { kind: 'pier' })).toBeNull()
    expect(classOf('landuse', 3, { kind: 'aerodrome' })).toBeNull()
    expect(classOf('landuse', 3, { kind: 'grass' })).toBeNull()
  })

  it('drops earth, points and features without a kind', () => {
    expect(classOf('earth', 3, { kind: 'earth' })).toBeNull()
    expect(classOf('roads', 1, { kind: 'highway' })).toBeNull()
    expect(classOf('roads', 2, {})).toBeNull()
  })
})
