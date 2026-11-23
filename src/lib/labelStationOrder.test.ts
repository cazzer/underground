import { describe, expect, it } from 'vitest'
import { labelStationOrder } from './labelStationOrder'

describe('labelStationOrder', () => {
  it('puts the focused station first, then the new ones in view order', () => {
    expect(labelStationOrder([], ['b', 'a', 'c'], 'a')).toEqual(['a', 'b', 'c'])
    expect(labelStationOrder([], ['b', 'a'], null)).toEqual(['b', 'a'])
  })

  it('keeps the labelled stations in their order and appends the joining ones', () => {
    expect(labelStationOrder(['a', 'c', 'b'], ['b', 'd', 'c', 'a'], 'a')).toEqual(['a', 'c', 'b', 'd'])
  })

  it('drops the stations no longer drawn', () => {
    expect(labelStationOrder(['a', 'c', 'b'], ['a', 'b'], 'a')).toEqual(['a', 'b'])
  })

  it('moves a newly focused station to the front, the rest keeping their order', () => {
    expect(labelStationOrder(['a', 'c', 'b'], ['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    // A focused station not drawn (yet) doesn't count.
    expect(labelStationOrder(['a', 'c'], ['a', 'c'], 'x')).toEqual(['a', 'c'])
  })

  it('returns the same array when nothing changed', () => {
    const prev = ['a', 'c', 'b']
    expect(labelStationOrder(prev, ['b', 'c', 'a'], 'a')).toBe(prev)
    expect(labelStationOrder(prev, ['b', 'c', 'a'], null)).toBe(prev)
  })
})
