import { describe, expect, it } from 'vitest'
import { nearestHit } from './pickStation'

const POSITIONS = [
  { x: 0, z: 0 },
  { x: 100, z: 0 },
  { x: 40, z: 0 },
]

describe('nearestHit', () => {
  it('picks the hit station nearest the pointer, not the first hit', () => {
    expect(nearestHit([0, 1, 2], POSITIONS, { x: 90, z: 5 })).toBe(1)
    expect(nearestHit([1, 0, 2], POSITIONS, { x: 30, z: 0 })).toBe(2)
  })

  it('only considers stations that were hit', () => {
    expect(nearestHit([0, 1], POSITIONS, { x: 40, z: 0 })).toBe(0)
  })

  it('returns -1 without hits', () => {
    expect(nearestHit([], POSITIONS, { x: 0, z: 0 })).toBe(-1)
  })
})
