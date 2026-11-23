import { describe, expect, it } from 'vitest'
import { loadStreetIndex } from './streetIndex'
import { streetFixture, streetFixtureFile } from './streetFixture'

describe('loadStreetIndex', () => {
  it('builds the key lookup, each street\'s crossings in both directions, and memoised tokens', () => {
    const index = streetFixture()
    expect(index.byKey.get('be')).toEqual([0])
    expect(index.byKey.get('40')).toEqual([5])
    expect(index.crossings.get(0)?.map((c) => [c.other, c.ownerFirst])).toEqual([[1, true], [7, true]])
    expect(index.crossings.get(1)?.map((c) => [c.other, c.ownerFirst])).toEqual([[0, false]])
    expect(index.tokens(0)).toBe(index.tokens(0))
    expect(index.tokens(0).map((t) => t.canon)).toEqual(['bedford', 'av'])
  })

  it('throws a fixed message on a wrong format, missing arrays, a dangling key or a bad intersection', () => {
    const file = streetFixtureFile()
    expect(() => loadStreetIndex(null)).toThrow('street index: wrong format')
    expect(() => loadStreetIndex({ ...file, format: 1 })).toThrow('street index: wrong format')
    expect(() => loadStreetIndex({ ...file, keys: null })).toThrow('street index: missing arrays')
    expect(() => loadStreetIndex({ ...file, keys: [['be', [99]]] })).toThrow('street index: a key names a missing street')
    expect(() => loadStreetIndex({ ...file, intersections: [[0, 99, [40.7, -73.9]]] })).toThrow('street index: a bad intersection')
    // Bedford Av (Brooklyn) and Broadway (Manhattan) cannot cross.
    expect(() => loadStreetIndex({ ...file, intersections: [[0, 2, [40.7, -73.9]]] })).toThrow('street index: a bad intersection')
    expect(() => loadStreetIndex({ ...file, intersections: [[0, 0, [40.7, -73.9]]] })).toThrow('street index: a bad intersection')
  })
})
