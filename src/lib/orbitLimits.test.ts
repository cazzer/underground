import { describe, expect, it } from 'vitest'
import { ENTER_RADIUS, EXIT_DISTANCE, EXIT_RADIUS } from './focusMachine'
import {
  azimuthBounds,
  azimuthLimit,
  clampToRadius,
  ORBIT_RADIUS,
  rotateScreenOffset,
  springToward,
  type AzimuthBounds,
} from './orbitLimits'

const LIMIT = Math.PI / 4

describe('ORBIT_RADIUS', () => {
  it('sits between the focus enter and exit radii, so panning never drops focus', () => {
    expect(ORBIT_RADIUS).toBeGreaterThan(ENTER_RADIUS)
    expect(ORBIT_RADIUS).toBeLessThan(EXIT_RADIUS)
  })
})

describe('springToward', () => {
  it('converges and lands on exactly the goal', () => {
    let v = 0.7
    for (let i = 0; i < 400 && v !== 0; i++) v = springToward(v, 0, 1 / 60, 4)
    expect(v).toBe(0)
  })

  it('never overshoots', () => {
    let v = -0.7
    for (let i = 0; i < 100; i++) {
      v = springToward(v, 0, 1 / 60, 4)
      expect(v).toBeLessThanOrEqual(0)
    }
  })

  it('is frame-rate independent: two half steps equal one step', () => {
    expect(springToward(springToward(0.5, 0, 0.05, 4), 0, 0.05, 4)).toBeCloseTo(springToward(0.5, 0, 0.1, 4), 12)
  })
})

describe('azimuthLimit', () => {
  it('is the full limit through EXIT_DISTANCE', () => {
    expect(azimuthLimit(180, LIMIT)).toBe(LIMIT)
    expect(azimuthLimit(EXIT_DISTANCE, LIMIT)).toBe(LIMIT)
  })

  it('falls linearly to zero at the top-down distance and stays there', () => {
    expect(azimuthLimit((EXIT_DISTANCE + 1400) / 2, LIMIT)).toBeCloseTo(LIMIT / 2)
    expect(azimuthLimit(1400, LIMIT)).toBe(0)
    expect(azimuthLimit(5000, LIMIT)).toBe(0)
  })
})

describe('azimuthBounds', () => {
  const out = (): AzimuthBounds => ({ min: 0, max: 0, rotate: false })

  it('focused: rotation on, symmetric window', () => {
    const b = azimuthBounds({ theta: 0.3, focused: true, distance: 180, limit: LIMIT, dt: 0.016 }, out())
    expect(b).toEqual({ min: -LIMIT, max: LIMIT, rotate: true })
  })

  it('focused but top-down: the window is closed', () => {
    const b = azimuthBounds({ theta: 0, focused: true, distance: 1500, limit: LIMIT, dt: 0.016 }, out())
    expect(b.min).toBeCloseTo(0, 12)
    expect(b.max).toBeCloseTo(0, 12)
  })

  it('unfocused: rotation off and min = max walks theta to exactly 0', () => {
    let theta = -LIMIT
    const b = out()
    for (let i = 0; i < 600 && theta !== 0; i++) {
      azimuthBounds({ theta, focused: false, distance: 600, limit: LIMIT, dt: 1 / 60 }, b)
      expect(b.rotate).toBe(false)
      expect(b.min).toBe(b.max)
      theta = b.min
    }
    expect(theta).toBe(0)
  })
})

describe('clampToRadius', () => {
  const c = { x: 100, z: -50 }

  it('leaves a point inside untouched', () => {
    const o = { x: 0, z: 0 }
    expect(clampToRadius({ x: 130, z: -10 }, c, 200, o)).toBe(false)
    expect(o).toEqual({ x: 130, z: -10 })
  })

  it('projects an outside point onto the circle on the same bearing', () => {
    const o = { x: 0, z: 0 }
    expect(clampToRadius({ x: 100 + 600, z: -50 + 800 }, c, 200, o)).toBe(true)
    expect(Math.hypot(o.x - c.x, o.z - c.z)).toBeCloseTo(200, 9)
    expect(o.x - c.x).toBeCloseTo(120)
    expect(o.z - c.z).toBeCloseTo(160)
  })
})

describe('rotateScreenOffset', () => {
  it('is the identity at azimuth 0: right is +x, toward the camera is +z', () => {
    expect(rotateScreenOffset(3, 4, 0)).toEqual({ x: 3, z: 4 })
  })

  it('at 90 degrees the camera is east of the target: toward-camera is +x and screen-right is north (-z)', () => {
    const o = rotateScreenOffset(3, 4, Math.PI / 2)
    expect(o.x).toBeCloseTo(4)
    expect(o.z).toBeCloseTo(-3)
  })

  it('preserves length', () => {
    const o = rotateScreenOffset(3, 4, 0.8)
    expect(Math.hypot(o.x, o.z)).toBeCloseTo(5)
  })
})
