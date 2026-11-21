import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { EXIT_RADIUS } from './focusMachine'
import { freeCenterShift, interiorFreeRect } from './interiorCamera'
import {
  AZIMUTH_SPRING,
  AZIMUTH_SPRING_MAX_SPEED,
  azimuthBounds,
  azimuthCap,
  FULL_SPIN_TILT,
  focusPoint,
  PAN_CLAMP_TILT,
  PAN_GIVE,
  PAN_MARGIN,
  PAN_RADIUS_BARE,
  PAN_RADIUS_MAX,
  panClampArmed,
  panRadius,
  pivotShift,
  rotateScreenOffset,
  softClampToRadius,
  springToNorth,
  springToward,
  wrapAngle,
  type AzimuthBounds,
} from './orbitLimits'
import { DEFAULT_TILT, depthFactor, ISO_POLAR, tiltForDistance, tiltT } from './tilt'

/** The farthest camera distance at which tiltT reaches `t` (tiltT falls with distance), to 0.01 m. */
function distanceAtTilt(t: number): number {
  let near = DEFAULT_TILT.nearDistance
  let far = DEFAULT_TILT.farDistance
  while (far - near > 0.01) {
    const mid = (near + far) / 2
    if (tiltT(mid) >= t) near = mid
    else far = mid
  }
  return near
}

describe('panRadius', () => {
  it('is the bare radius without an interior, else the reach plus the margin', () => {
    expect(panRadius(null)).toBe(PAN_RADIUS_BARE)
    expect(panRadius(90)).toBe(90 + PAN_MARGIN)
  })

  it('is capped so a full stretch plus the view offset never drops focus', () => {
    expect(panRadius(1000)).toBe(PAN_RADIUS_MAX)
    // The target sits off the focus point by the free-area shift plus the depth term (drawn at the
    // depth factor, as useStationOrbit sizes it), on a phone with a stacked panel, at every distance the
    // clamp applies at: out to where the tilt reaches PAN_CLAMP_TILT (about 750 m once the tilt's near
    // distance is 400 m), where the shift is largest. A 30 m mid-depth (scaled) covers a deep station like
    // 191 St at yScale 1, and is three times the starter stations'.
    const phone = { width: 390, height: 844 }
    const free = interiorFreeRect(phone, { top: 80, bottom: 70 }, { left: 16, top: 470, right: 374, bottom: 770 })
    const outer = distanceAtTilt(PAN_CLAMP_TILT)
    expect(outer).toBeCloseTo(Math.sqrt(DEFAULT_TILT.farDistance * DEFAULT_TILT.nearDistance), 1)
    let worst = 0
    for (let d = DEFAULT_TILT.nearDistance; d <= outer; d += 5) {
      const polar = tiltForDistance(d)
      const s = freeCenterShift(phone, free, 35, d, polar, { right: 0, toward: 0 })
      worst = Math.max(worst, Math.hypot(s.right, s.toward + 30 * depthFactor(d) * Math.tan(polar)))
    }
    expect(PAN_RADIUS_MAX + PAN_GIVE + worst).toBeLessThan(EXIT_RADIUS)
    // A bare station pivots on the free area's middle too (no depth term, so `worst` over-covers it).
    expect(PAN_RADIUS_BARE + PAN_GIVE + worst).toBeLessThan(EXIT_RADIUS)
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

describe('wrapAngle', () => {
  it('maps any angle into (-π, π]', () => {
    expect(wrapAngle(0.4)).toBeCloseTo(0.4, 12)
    expect(wrapAngle(Math.PI)).toBe(Math.PI)
    expect(wrapAngle(-Math.PI)).toBe(Math.PI)
    expect(wrapAngle(3.3)).toBeCloseTo(3.3 - 2 * Math.PI, 12)
    expect(wrapAngle(-3.3)).toBeCloseTo(2 * Math.PI - 3.3, 12)
    expect(wrapAngle(7 * Math.PI + 0.2)).toBeCloseTo(-Math.PI + 0.2, 9)
  })
})

describe('azimuthCap', () => {
  it('is unlimited from FULL_SPIN_TILT to full tilt', () => {
    expect(azimuthCap(1)).toBe(Infinity)
    expect(azimuthCap(FULL_SPIN_TILT)).toBe(Infinity)
    expect(azimuthCap(tiltT(DEFAULT_TILT.nearDistance))).toBe(Infinity)
  })

  it('rises linearly from zero top-down to π just below FULL_SPIN_TILT', () => {
    expect(azimuthCap(0)).toBe(0)
    expect(azimuthCap(tiltT(DEFAULT_TILT.farDistance))).toBe(0)
    expect(azimuthCap(tiltT(5000))).toBe(0)
    expect(azimuthCap(FULL_SPIN_TILT / 2)).toBeCloseTo(Math.PI / 2, 12)
    expect(azimuthCap(FULL_SPIN_TILT - 1e-9)).toBeCloseTo(Math.PI, 6)
  })

  it('never falls as the camera comes in', () => {
    let prev = -1
    for (let d = 5000; d >= 100; d -= 10) {
      const cap = azimuthCap(tiltT(d))
      expect(cap).toBeGreaterThanOrEqual(prev)
      prev = cap
    }
  })
})

describe('azimuthBounds', () => {
  const out = (): AzimuthBounds => ({ min: 0, max: 0 })

  it('focused and close: no window at all, so the view spins a full turn', () => {
    for (const theta of [0, 2, Math.PI, -3]) {
      const b = azimuthBounds({ theta, focused: true, tilt: 1, dt: 0.016, reducedMotion: false }, out())
      expect(b).toEqual({ min: -Infinity, max: Infinity })
    }
  })

  it('focused but top-down: the window is closed', () => {
    const b = azimuthBounds({ theta: 0, focused: true, tilt: 0, dt: 0.016, reducedMotion: false }, out())
    expect(b.min).toBeCloseTo(0, 12)
    expect(b.max).toBeCloseTo(0, 12)
  })

  it('focused and partly tilted: the window is ±azimuthCap', () => {
    const b = azimuthBounds({ theta: 0.2, focused: true, tilt: 0.3, dt: 0.016, reducedMotion: false }, out())
    expect(b.max).toBeCloseTo((Math.PI * 0.3) / FULL_SPIN_TILT, 12)
    expect(b.min).toBe(-b.max)
  })

  it('unfocused: min = max walks theta to exactly 0', () => {
    let theta = -Math.PI / 4
    const b = out()
    for (let i = 0; i < 600 && theta !== 0; i++) {
      azimuthBounds({ theta, focused: false, tilt: 1, dt: 1 / 60, reducedMotion: false }, b)
      expect(b.min).toBe(b.max)
      theta = b.min
    }
    expect(theta).toBe(0)
  })

  it('unfocused near ±π: springs the short way, never sweeping through the long way', () => {
    // 3.3 rad past π is -2.98 the short way: the spring must go up through -2.9, not down through 3.
    const b = azimuthBounds({ theta: 3.3, focused: false, tilt: 1, dt: 1 / 60, reducedMotion: false }, out())
    expect(b.min).toBeLessThan(0)
    expect(b.min).toBeGreaterThan(wrapAngle(3.3))
    const c = azimuthBounds({ theta: -3.3, focused: false, tilt: 1, dt: 1 / 60, reducedMotion: false }, out())
    expect(c.min).toBeGreaterThan(0)
    expect(c.min).toBeLessThan(wrapAngle(-3.3))
  })

  it('unfocused from 180 degrees while zooming out: north-up by the top-down distance whatever the pace', () => {
    let theta = Math.PI
    const b = out()
    // A fast zoom out from full tilt to top-down in a third of a second, far quicker than the spring.
    const { nearDistance, farDistance } = DEFAULT_TILT
    for (let i = 0; i <= 20; i++) {
      const tilt = tiltT(nearDistance + ((farDistance - nearDistance) * i) / 20)
      azimuthBounds({ theta, focused: false, tilt, dt: 1 / 60, reducedMotion: false }, b)
      expect(Math.abs(b.min)).toBeLessThanOrEqual(azimuthCap(tilt))
      theta = b.min
    }
    expect(theta).toBe(0)
  })
})

describe('springToNorth', () => {
  it('never turns faster than the speed cap after a big turn', () => {
    const dt = 1 / 60
    let theta = Math.PI - 0.01
    for (let i = 0; i < 60; i++) {
      const next = springToNorth(theta, dt, false)
      expect(Math.abs(next - theta)).toBeLessThanOrEqual(AZIMUTH_SPRING_MAX_SPEED * dt + 1e-12)
      theta = next
    }
    // A second at the cap brings 179° down to about 0, no further.
    expect(theta).toBeGreaterThan(0)
  })

  it('keeps the plain exponential ease for small angles, and lands exactly on 0', () => {
    expect(springToNorth(0.5, 1 / 60, false)).toBeCloseTo(springToward(0.5, 0, 1 / 60, AZIMUTH_SPRING), 12)
    let theta = 2
    for (let i = 0; i < 600 && theta !== 0; i++) theta = springToNorth(theta, 1 / 60, false)
    expect(theta).toBe(0)
  })

  it('snaps straight to north-up under reduced motion', () => {
    expect(springToNorth(2.5, 1 / 60, true)).toBe(0)
    const b = azimuthBounds({ theta: -3, focused: false, tilt: 1, dt: 1 / 60, reducedMotion: true }, { min: 1, max: 1 })
    expect(b).toEqual({ min: 0, max: 0 })
  })
})

describe('panClampArmed', () => {
  it('a released hold outside R does not jump: it arms only once the view comes inside', () => {
    let armed = panClampArmed(false, true, true, 1, false)
    expect(armed).toBe(false)
    armed = panClampArmed(armed, true, false, 1, false)
    expect(armed).toBe(false)
    armed = panClampArmed(armed, true, false, 1, true)
    expect(armed).toBe(true)
    armed = panClampArmed(armed, true, false, 1, false)
    expect(armed).toBe(true)
  })

  it('disarms while busy and when the focus center changes', () => {
    expect(panClampArmed(true, true, true, 1, true)).toBe(false)
    expect(panClampArmed(true, false, false, 1, false)).toBe(false)
  })

  it('is off below PAN_CLAMP_TILT, so a pan from far out is free', () => {
    expect(panClampArmed(true, true, false, PAN_CLAMP_TILT - 1e-6, true)).toBe(false)
    expect(panClampArmed(false, true, false, PAN_CLAMP_TILT, true)).toBe(true)
  })

  it('zooming in past PAN_CLAMP_TILT outside R does not pull the view in', () => {
    let armed = panClampArmed(true, true, false, 0.3, false)
    armed = panClampArmed(armed, true, false, 0.6, false)
    expect(armed).toBe(false)
    armed = panClampArmed(armed, true, false, 0.7, true)
    expect(armed).toBe(true)
  })
})

describe('softClampToRadius', () => {
  const c = { x: 100, z: -50 }
  const r = 120

  it('leaves a point inside untouched', () => {
    const o = { x: 0, z: 0 }
    expect(softClampToRadius({ x: 130, z: -10 }, c, r, 1 / 60, o)).toBe(false)
    expect(o).toEqual({ x: 130, z: -10 })
  })

  it('never lets a stretch pass the give, on the same bearing', () => {
    const o = { x: 0, z: 0 }
    expect(softClampToRadius({ x: 100 + 600, z: -50 + 800 }, c, r, 1 / 60, o)).toBe(true)
    const d = Math.hypot(o.x - c.x, o.z - c.z)
    expect(d).toBeCloseTo(r + PAN_GIVE, 9)
    expect((o.x - c.x) / d).toBeCloseTo(0.6)
    expect((o.z - c.z) / d).toBeCloseTo(0.8)
  })

  it('eases a released stretch back onto the circle without overshoot', () => {
    let p = { x: c.x + r + 20, z: c.z }
    let prev = 20
    for (let i = 0; i < 600; i++) {
      const o = { x: 0, z: 0 }
      if (!softClampToRadius(p, c, r, 1 / 60, o)) break
      const stretch = o.x - c.x - r
      expect(stretch).toBeGreaterThanOrEqual(0)
      expect(stretch).toBeLessThan(prev)
      prev = stretch
      p = o
    }
    expect(p.x).toBe(c.x + r)
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

describe('pivotShift', () => {
  const phone = { width: 390, height: 844 }
  const free = interiorFreeRect(phone, { top: 80, bottom: 70 }, { left: 16, top: 470, right: 374, bottom: 770 })
  const distance = 180
  const depth = 9
  const towardCamera = depth * Math.tan(ISO_POLAR)

  function camera(target: Vector3, theta: number) {
    const cam = new PerspectiveCamera(35, phone.width / phone.height, 1, 5000)
    cam.position.copy(target).add(new Vector3().setFromSphericalCoords(distance, ISO_POLAR, theta))
    cam.lookAt(target)
    cam.updateMatrixWorld()
    return cam
  }
  const screen = (p: Vector3, cam: PerspectiveCamera) => {
    const v = p.clone().project(cam)
    return { x: ((v.x + 1) / 2) * phone.width, y: ((1 - v.y) / 2) * phone.height }
  }

  it.each([
    [0, 0.6],
    [-0.5, 1.0],
    [0.7, -0.7],
  ])('turning from %f to %f rad keeps the interior mid-depth center at the free area middle', (theta0, theta1) => {
    const s = freeCenterShift(phone, free, 35, distance, ISO_POLAR, { right: 0, toward: 0 })
    s.toward += towardCamera
    const target = new Vector3(500, 0, -300)
    const p = focusPoint({ x: target.x, z: target.z }, s.right, s.toward, theta0, { x: 0, z: 0 })
    const interiorCenter = new Vector3(p.x, -depth, p.z)
    const before = screen(interiorCenter, camera(target, theta0))
    // Near, not on: the shift is sized at the target's depth, and perspective stretches the phone's
    // ~150 px vertical offset by about a fifth (frameInterior lands in the same spot).
    expect(Math.abs(before.x - (free.left + free.right) / 2)).toBeLessThan(15)
    expect(Math.abs(before.y - (free.top + free.bottom) / 2)).toBeLessThan(40)

    // The controls turn the camera about the target; the shift then slides both.
    const m = pivotShift(s.right, s.toward, theta0, theta1, { x: 0, z: 0 })
    const after = screen(interiorCenter, camera(target.clone().add(new Vector3(m.x, 0, m.z)), theta1))
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it('is zero when the angle held, and the focus point is the target with no offset', () => {
    expect(pivotShift(12, 30, 0.4, 0.4, { x: 1, z: 1 })).toEqual({ x: 0, z: 0 })
    expect(focusPoint({ x: 3, z: 4 }, 0, 0, 0.9, { x: 0, z: 0 })).toEqual({ x: 3, z: 4 })
  })
})
