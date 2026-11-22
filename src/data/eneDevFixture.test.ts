import { describe, expect, it } from 'vitest'
import { devEneCodes, devEneSnapshot } from './eneDevFixture'

describe('devEneCodes', () => {
  it('reads a comma list, uppercased', () => {
    expect(devEneCodes('?ene=EL358,es112')).toEqual(['EL358', 'ES112'])
  })

  it('drops entries that are not equipment codes', () => {
    expect(devEneCodes('?ene=EL358,,x,12,EL 1,../etc')).toEqual(['EL358'])
  })

  it('is null when the parameter is absent', () => {
    expect(devEneCodes('')).toBeNull()
    expect(devEneCodes('?lines=b')).toBeNull()
  })
})

describe('devEneSnapshot', () => {
  it('lists each code out since an hour ago and due back in three, sorted', () => {
    const s = devEneSnapshot(['EL359', 'EL358'], 10_000)
    expect(s.generatedAt).toBe(10_000)
    expect(s.outages.map((o) => o.code)).toEqual(['EL358', 'EL359'])
    expect(s.outages[0]).toMatchObject({ reason: null, since: 10_000 - 3600, returnAt: 10_000 + 3 * 3600 })
  })
})
