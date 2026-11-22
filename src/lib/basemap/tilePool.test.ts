import { describe, expect, it } from 'vitest'
import { planPool } from './tilePool'

describe('planPool', () => {
  it('appends every tile on a first draw, keeping nothing', () => {
    expect(planPool([], [3, 1, 2])).toEqual({ order: [3, 1, 2], keep: 0 })
  })

  it('keeps the whole order and appends new tiles when none is removed', () => {
    expect(planPool([3, 1], [1, 2, 3, 4])).toEqual({ order: [3, 1, 2, 4], keep: 2 })
  })

  it('keeps only the prefix before the first removed tile', () => {
    expect(planPool([5, 6, 7, 8], [5, 7, 8, 9])).toEqual({ order: [5, 7, 8, 9], keep: 1 })
  })

  it('rewrites everything when the first tile goes', () => {
    expect(planPool([5, 6, 7], [6, 7])).toEqual({ order: [6, 7], keep: 0 })
  })

  it('keeps all of an unchanged set, whatever its drawn order', () => {
    expect(planPool([1, 2, 3], [3, 2, 1])).toEqual({ order: [1, 2, 3], keep: 3 })
  })

  it('empties to nothing', () => {
    expect(planPool([1, 2], [])).toEqual({ order: [], keep: 0 })
  })
})
