import { describe, expect, it } from 'vitest'
import { boundsCenter, fitDistance, frameBounds } from './framing'

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

describe('frameBounds', () => {
  const city = { minX: -20_000, maxX: 22_000, minZ: -23_000, maxZ: 20_000 }
  const viewport = { width: 1440, height: 900 }

  /** Screen y (CSS px) of a ground z under a top-down framing. */
  function screenY(z: number, f: ReturnType<typeof frameBounds>): number {
    const metersPerPx = (2 * f.distance * TAN) / viewport.height
    return viewport.height / 2 + (z - f.target.z) / metersPerPx
  }

  it('matches fitDistance and the bounds center without insets', () => {
    const f = frameBounds(city, viewport, { top: 0, bottom: 0 })
    expect(f.distance).toBeCloseTo(fitDistance(city, 1440 / 900))
    expect(f.target).toEqual(boundsCenter(city))
  })

  it('keeps the bounds between the insets, with the margin split evenly', () => {
    const insets = { top: 60, bottom: 120 }
    const f = frameBounds(city, viewport, insets)
    const north = screenY(city.minZ, f)
    const south = screenY(city.maxZ, f)
    expect(north).toBeGreaterThan(insets.top)
    expect(south).toBeLessThan(viewport.height - insets.bottom)
    expect(north - insets.top).toBeCloseTo(viewport.height - insets.bottom - south)
  })

  it('shifts the target south when the bottom inset is larger', () => {
    // The free band's center is above the viewport center, so the viewport center sits south of the city's.
    const f = frameBounds(city, viewport, { top: 60, bottom: 120 })
    expect(f.target.z).toBeGreaterThan(boundsCenter(city).z)
    expect(f.target.x).toBe(boundsCenter(city).x)
  })

  it('costs nothing in a width-bound portrait viewport', () => {
    const portrait = { width: 390, height: 844 }
    const plain = frameBounds(city, portrait, { top: 0, bottom: 0 })
    expect(frameBounds(city, portrait, { top: 50, bottom: 110 }).distance).toBeCloseTo(plain.distance)
  })
})
