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

describe('expectStationIndex complex members', () => {
  const base = { T01: { provenance: 'authored' }, U01: { provenance: 'authored', file: 'T01' } }
  it('accepts an alias entry naming a listed interior', () => {
    const raw = { stations: base }
    expect(expectStationIndex(raw, URL)).toBe(raw)
  })

  it.each([
    ['an unlisted target', { U01: { provenance: 'authored', file: 'T09' } }],
    ['a chain', { ...base, V01: { provenance: 'authored', file: 'U01' } }],
    ['itself', { T01: { provenance: 'authored', file: 'T01' } }],
    ['a non-string file', { ...base, U01: { provenance: 'authored', file: 5 } }],
    ['a path traversal', { ...base, U01: { provenance: 'authored', file: '../x' } }],
    ['the index file as a target', { index: { provenance: 'authored' }, U01: { provenance: 'authored', file: 'index' } }],
    ['the equipment file as a target', { equipment: { provenance: 'authored' }, U01: { provenance: 'authored', file: 'equipment' } }],
    ['the amenities file as a target', { amenities: { provenance: 'authored' }, U01: { provenance: 'authored', file: 'amenities' } }],
    ['an inherited key', { U01: { provenance: 'authored', file: 'toString' } }],
  ])('rejects %s', (_name, stations) => {
    expect(() => expectStationIndex({ stations }, URL)).toThrow(URL)
  })
})
