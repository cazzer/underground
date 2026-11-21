import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import { freeCenterShift, interiorFreeRect } from './interiorCamera'
import { focusPoint, pivotShift, rotateScreenOffset } from './orbitLimits'
import { ISO_POLAR } from './tilt'

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
