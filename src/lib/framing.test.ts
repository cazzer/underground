import { describe, expect, it } from 'vitest'
import { boundsCenter, fitDistance, frameBounds, framePoint } from './framing'
import { tiltForDistance } from './tilt'

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

describe('framePoint', () => {
  const viewport = { width: 1440, height: 900 }
  const none = { top: 0, bottom: 0 }
  const center = { x: 500, z: -300 }

  it('grows with the radius', () => {
    const small = framePoint(center, 300, viewport, none, 35, 100, 1e6)
    const big = framePoint(center, 900, viewport, none, 35, 100, 1e6)
    expect(big.distance).toBeGreaterThan(small.distance)
  })

  it('clamps to the minimum and maximum distance', () => {
    expect(framePoint(center, 10, viewport, none, 35, 504, 1e6).distance).toBe(504)
    expect(framePoint(center, 1e6, viewport, none, 35, 504, 5000).distance).toBe(5000)
  })

  it('centers the point with equal insets', () => {
    expect(framePoint(center, 300, viewport, { top: 80, bottom: 80 }, 35, 100, 1e6).target).toEqual(center)
  })

  it('shifts the target south by the clamped meters-per-pixel for a top inset', () => {
    const f = framePoint(center, 10, viewport, { top: 200, bottom: 0 }, 35, 1500, 1e6)
    const metersPerPx = (2 * 1500 * TAN) / viewport.height
    expect(f.distance).toBe(1500)
    expect(f.target.x).toBe(center.x)
    expect(f.target.z).toBeCloseTo(center.z - 100 * metersPerPx)
  })

  it('puts the point in the free band middle when the view is tipped', () => {
    const insets = { top: 120, bottom: 360 }
    const f = framePoint(center, 10, viewport, insets, 35, 600, 600)
    const polar = tiltForDistance(600)
    expect(polar).toBeGreaterThan(0.5)
    // Project the point through the camera OrbitControls puts at f.target, 600 m out, north-up.
    const cam = { x: f.target.x, y: 600 * Math.cos(polar), z: f.target.z + 600 * Math.sin(polar) }
    const rel = { y: -cam.y, z: center.z - cam.z }
    const forward = rel.y * -Math.cos(polar) + rel.z * -Math.sin(polar)
    const up = rel.y * Math.sin(polar) + rel.z * -Math.cos(polar)
    const ndcY = up / forward / TAN
    expect(ndcY).toBeCloseTo((insets.bottom - insets.top) / viewport.height, 6)
    // Horizontally the point stays on the middle.
    expect(f.target.x).toBe(center.x)
  })
})
