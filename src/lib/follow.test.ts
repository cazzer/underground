import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  anchorJumped,
  createFollowView,
  decayCatch,
  FOLLOW_BREAK_PX,
  FOLLOW_BREAK_PX_TOUCH,
  FOLLOW_DISTANCE,
  FOLLOW_FIT,
  FOLLOW_MAX_DISTANCE,
  followDistanceFor,
  FOLLOW_CATCH_SNAP_M,
  FOLLOW_JUMP_PX,
  followTargetInto,
  metersPerPx,
  panBroke,
  writeFollowView,
} from './follow'
import type { ScreenRect } from './interiorCamera'
import { consistFor } from './live/consist'
import { ISO_POLAR } from './tilt'

const FOV = 35

/** Screen px of `p` for a camera posed as OrbitControls poses it: at target + distance along (polar, azimuth), up +y. */
function project(p: Vector3, target: Vector3, distance: number, polar: number, azimuth: number, w: number, h: number) {
  const cam = new PerspectiveCamera(FOV, w / h, 1, 1e6)
  const b = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
  cam.position.copy(target).addScaledVector(b, distance)
  cam.lookAt(target)
  cam.updateMatrixWorld()
  const ndc = p.clone().project(cam)
  return { x: ((ndc.x + 1) / 2) * w, y: ((1 - ndc.y) / 2) * h }
}

const PHONE = { width: 390, height: 844 }
const PHONE_FREE: ScreenRect = { left: 0, top: 120, right: 390, bottom: 380 }
const DESK = { width: 1440, height: 900 }
const DESK_FREE: ScreenRect = { left: 0, top: 90, right: 1100, bottom: 860 }
/** 320x640 with the train panel's stop list expanded: a 37 px strip above it. */
const SMALL = { width: 320, height: 640 }
const SMALL_FREE: ScreenRect = { left: 0, top: 110, right: 320, bottom: 147 }

describe('followTargetInto', () => {
  const cases = [
    { name: 'phone', viewport: PHONE, free: PHONE_FREE },
    { name: 'desktop', viewport: DESK, free: DESK_FREE },
    { name: '320x640 strip', viewport: SMALL, free: SMALL_FREE },
  ]
  for (const { name, viewport, free } of cases) {
    it(`puts the train mid-free on the ${name} at any azimuth, polar and height`, () => {
      const cx = (free.left + free.right) / 2
      const cy = (free.top + free.bottom) / 2
      const v = createFollowView()
      const out = { x: 0, z: 0 }
      for (const distance of [40, 400, 1000, 5000]) {
        for (const polar of [0.001, 0.5, ISO_POLAR]) {
          for (const azimuth of [0, 1, -2.5, Math.PI]) {
            for (const y of [-20, 0, 10]) {
              const p = new Vector3(1234, y, -5678)
              writeFollowView(v, viewport, free, FOV, distance, polar, azimuth)
              followTargetInto(p, v, out)
              const s = project(p, new Vector3(out.x, 0, out.z), distance, polar, azimuth, viewport.width, viewport.height)
              expect(Math.abs(s.x - cx)).toBeLessThan(0.5)
              expect(Math.abs(s.y - cy)).toBeLessThan(0.5)
            }
          }
        }
      }
    })
  }

  it('is the point itself, top-down with the free area centered', () => {
    const v = writeFollowView(createFollowView(), PHONE, { left: 0, top: 0, right: 390, bottom: 844 }, FOV, 1000, 0, 0)
    const out = followTargetInto({ x: 10, y: 0, z: 20 }, v, { x: 0, z: 0 })
    expect(out.x).toBeCloseTo(10, 9)
    expect(out.z).toBeCloseTo(20, 9)
  })
})

describe('decayCatch', () => {
  it('eases toward 0 at the catch-up rate', () => {
    const c = { x: 100, z: -50 }
    decayCatch(c, 0.2, false)
    expect(c.x).toBeCloseTo(100 * Math.exp(-1), 6)
    expect(c.z).toBeCloseTo(-50 * Math.exp(-1), 6)
  })

  it('snaps under the snap distance', () => {
    const c = { x: FOLLOW_CATCH_SNAP_M * 0.6, z: FOLLOW_CATCH_SNAP_M * 0.6 }
    decayCatch(c, 0.001, false)
    expect(c).toEqual({ x: 0, z: 0 })
  })

  it('is gone at once under reduced motion', () => {
    const c = { x: 500, z: 500 }
    decayCatch(c, 1 / 60, true)
    expect(c).toEqual({ x: 0, z: 0 })
  })
})

describe('thresholds', () => {
  it('breaks the follow at the pan threshold, larger on touch', () => {
    expect(panBroke(FOLLOW_BREAK_PX - 0.1, false)).toBe(false)
    expect(panBroke(FOLLOW_BREAK_PX, false)).toBe(true)
    expect(panBroke(FOLLOW_BREAK_PX_TOUCH - 0.1, true)).toBe(false)
    expect(panBroke(FOLLOW_BREAK_PX_TOUCH, true)).toBe(true)
  })

  it('flies over a jump bigger than the jump threshold on screen', () => {
    const mpp = metersPerPx(400, FOV, 844)
    expect(anchorJumped(FOLLOW_JUMP_PX * mpp * 0.99, mpp)).toBe(false)
    expect(anchorJumped(FOLLOW_JUMP_PX * mpp * 1.01, mpp)).toBe(true)
  })

  it('sizes a pixel at the target like the projection does', () => {
    const mpp = metersPerPx(400, FOV, 844)
    const a = project(new Vector3(0, 0, 0), new Vector3(), 400, 0.001, 0, 390, 844)
    const b = project(new Vector3(100 * mpp, 0, 0), new Vector3(), 400, 0.001, 0, 390, 844)
    expect(b.x - a.x).toBeCloseTo(100, 1)
  })
})

describe('followDistanceFor', () => {
  const ten = consistFor('A')
  const tenM = ten.cars * ten.pitchM

  it('keeps the landing distance on a desktop', () => {
    expect(followDistanceFor(tenM, DESK, DESK_FREE, FOV)).toBe(FOLLOW_DISTANCE)
  })

  it('pulls back on a phone, to at most the cap', () => {
    const d = followDistanceFor(tenM, PHONE, PHONE_FREE, FOV)
    expect(d).toBeGreaterThan(FOLLOW_DISTANCE)
    expect(d).toBeLessThanOrEqual(FOLLOW_MAX_DISTANCE)
    expect(followDistanceFor(1000, PHONE, PHONE_FREE, FOV)).toBe(FOLLOW_MAX_DISTANCE)
  })

  it('fits the train to the fit share of the free width when unclamped', () => {
    // 120 m fits the phone's free width between the two clamps.
    const m = 120
    const d = followDistanceFor(m, PHONE, PHONE_FREE, FOV)
    expect(d).toBeGreaterThan(FOLLOW_DISTANCE)
    expect(d).toBeLessThan(FOLLOW_MAX_DISTANCE)
    const a = project(new Vector3(0, 0, 0), new Vector3(), d, 0.001, 0, PHONE.width, PHONE.height)
    const b = project(new Vector3(m, 0, 0), new Vector3(), d, 0.001, 0, PHONE.width, PHONE.height)
    expect(b.x - a.x).toBeCloseTo(FOLLOW_FIT * (PHONE_FREE.right - PHONE_FREE.left), 0)
  })
})
