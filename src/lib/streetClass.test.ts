import { describe, expect, it } from 'vitest'
import { isArea, isClosedRing, isStreet } from './streetClass.ts'

describe('isClosedRing', () => {
  it('needs four entries with the first equal to the last', () => {
    expect(isClosedRing([1, 2, 3, 1])).toBe(true)
    expect(isClosedRing([1, 2, 3, 4])).toBe(false)
    expect(isClosedRing([1, 2, 1])).toBe(false)
    expect(isClosedRing([])).toBe(false)
  })
})

describe('isStreet', () => {
  it('takes named roadway classes', () => {
    for (const highway of ['primary', 'secondary_link', 'residential', 'service', 'living_street']) {
      expect(isStreet({ highway, name: 'Main St' }, false), highway).toBe(true)
    }
  })

  it('skips unnamed ways, motorways and footpaths', () => {
    expect(isStreet({ highway: 'residential', name: null }, false)).toBe(false)
    expect(isStreet({ highway: 'residential', name: '  ' }, false)).toBe(false)
    expect(isStreet({ highway: 'residential', name: '...' }, false)).toBe(false)
    expect(isStreet({ highway: 'residential', name: 'The' }, false)).toBe(false)
    for (const highway of ['motorway', 'motorway_link', 'footway', 'steps', 'path', 'cycleway']) {
      expect(isStreet({ highway, name: 'Main St' }, false), highway).toBe(false)
    }
  })

  it('counts a pedestrian line as a street and a closed pedestrian ring as a plaza', () => {
    expect(isStreet({ highway: 'pedestrian', name: 'Stone St' }, false)).toBe(true)
    expect(isStreet({ highway: 'pedestrian', name: 'Fulton Mall' }, true)).toBe(false)
  })

  it('keeps a closed residential loop a street', () => {
    expect(isArea({ highway: 'residential', name: 'Circle Rd' }, true)).toBe(false)
    expect(isStreet({ highway: 'residential', name: 'Circle Rd' }, true)).toBe(true)
  })
})
