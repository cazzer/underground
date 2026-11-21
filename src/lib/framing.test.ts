import { describe, expect, it } from 'vitest'
import { boundsCenter, fitDistance } from './framing'

const square = (half: number) => ({ minX: -half, maxX: half, minZ: -half, maxZ: half })
const TAN = Math.tan((35 * Math.PI) / 360)

describe('fitDistance', () => {
  it('is bound by height in landscape', () => {
    expect(fitDistance(square(1000), 1.6, 35, 1)).toBeCloseTo(1000 / TAN)
  })

  it('is bound by width in portrait', () => {
    expect(fitDistance(square(1000), 0.5, 35, 1)).toBeCloseTo(2000 / TAN)
  })

  it('applies the margin', () => {
    expect(fitDistance(square(1000), 1, 35, 1.1)).toBeCloseTo((1000 / TAN) * 1.1)
  })

  it('grows with the bounds', () => {
    expect(fitDistance(square(2000), 1.6)).toBeGreaterThan(fitDistance(square(1000), 1.6))
  })
})

describe('boundsCenter', () => {
  it('returns the midpoint', () => {
    expect(boundsCenter({ minX: 0, maxX: 10, minZ: -4, maxZ: 2 })).toEqual({ x: 5, z: -1 })
  })
})
