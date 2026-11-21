import { describe, expect, it } from 'vitest'
import { expectStationIndex } from './loadStationIndex'

const URL = 'x/index.json'

describe('expectStationIndex', () => {
  it('accepts authored and generated entries', () => {
    const raw = { stations: { L08: { provenance: 'authored' }, A01: { provenance: 'generated' } } }
    expect(expectStationIndex(raw, URL)).toBe(raw)
  })

  it('accepts an empty index', () => {
    expect(expectStationIndex({ stations: {} }, URL)).toEqual({ stations: {} })
  })

  it.each([
    ['null', null],
    ['no stations', {}],
    ['an array of stations', { stations: [] }],
    ['an entry without provenance', { stations: { L08: {} } }],
    ['an unknown provenance', { stations: { L08: { provenance: 'guessed' } } }],
    ['a non-object entry', { stations: { L08: 'authored' } }],
  ])('rejects %s', (_name, raw) => {
    expect(() => expectStationIndex(raw, URL)).toThrow(URL)
  })
})
