import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  frameInterior,
  interiorFreeRect,
  LANDING_AXIS_OFF_VERTICAL,
  LANDING_DISTANCE,
  landingAzimuth,
  LATE_TURN_PROGRESS,
  retargetTurn,
  type InteriorFrameInput,
} from './interiorCamera'
import { ENTER_DISTANCE, ENTER_RADIUS, EXIT_RADIUS } from './focusMachine'
import { interiorOpacity } from './interiorReveal'
import { DEFAULT_TILT, ISO_POLAR, tiltT } from './tilt'

const viewport = { width: 1440, height: 900 }
const insets = { top: 70, bottom: 90 }

describe('interiorFreeRect', () => {
  it('is the band between the header and footer without a panel', () => {
    expect(interiorFreeRect(viewport, insets, null)).toEqual({ left: 0, top: 70, right: 1440, bottom: 810 })
  })

  it('stops left of a right-hand panel', () => {
    const panel = { left: 1136, top: 628, right: 1424, bottom: 884 }
    expect(interiorFreeRect(viewport, insets, panel, 16)).toEqual({ left: 0, top: 70, right: 1120, bottom: 810 })
  })

  it('stops above a stacked panel', () => {
    const phone = { width: 390, height: 844 }
    const panel = { left: 16, top: 500, right: 374, bottom: 760 }
    expect(interiorFreeRect(phone, insets, panel, 16).bottom).toBe(484)
  })
})

const center = { x: 1000, z: 2000 }
const north = { towardCamera: 0, azimuth: 0 }
const mpp = (d: number, height: number) => (2 * d * Math.tan((35 * Math.PI) / 360)) / height

describe('frameInterior', () => {
  const cases: [string, InteriorFrameInput][] = [
    [
      'desktop 1440x900, panel on the right',
      { center, ...north, viewport, fovDeg: 35, free: interiorFreeRect(viewport, insets, { left: 1136, top: 628, right: 1424, bottom: 884 }) },
    ],
    [
      'phone 390x844, panel stacked above the footer',
      {
        center,
        ...north,
        viewport: { width: 390, height: 844 },
        fovDeg: 35,
        free: interiorFreeRect({ width: 390, height: 844 }, { top: 80, bottom: 70 }, { left: 16, top: 470, right: 374, bottom: 770 }),
      },
    ],
    ['a tiny free rect', { center, ...north, viewport, fovDeg: 35, free: { left: 0, top: 70, right: 40, bottom: 90 } }],
  ]

  it("lands at the tilt's near distance, inside the focus range", () => {
    expect(LANDING_DISTANCE).toBe(DEFAULT_TILT.nearDistance)
    expect(LANDING_DISTANCE).toBeLessThan(ENTER_DISTANCE)
  })

  it.each(cases)('%s: lands in full 3D at full reveal and keeps the station focused', (name, input) => {
    const { distance, target } = frameInterior(input)
    expect(distance).toBe(LANDING_DISTANCE)
    expect(tiltT(distance)).toBe(1)
    expect(interiorOpacity(distance)).toBe(1)
    // The view center stays close enough that the camera-driven focus keeps this station: within the
    // enter radius on a real layout (no neighbour can take over), and inside the exit radius even when
    // the free rect is a sliver.
    const off = Math.hypot(target.x - center.x, target.z - center.z)
    expect(off).toBeLessThan(name === 'a tiny free rect' ? EXIT_RADIUS : ENTER_RADIUS)
  })

  it('keeps the center when the free rect is the whole viewport', () => {
    const free = { left: 0, top: 0, right: 1440, bottom: 900 }
    expect(frameInterior({ center, ...north, viewport, free, fovDeg: 35 })).toEqual({ distance: LANDING_DISTANCE, target: center })
  })

  it('shifts the target east when the free rect is left of center, so the interior moves left', () => {
    const { target } = frameInterior({ center, ...north, viewport, fovDeg: 35, free: { left: 0, top: 0, right: 1120, bottom: 900 } })
    expect(target.x).toBeCloseTo(1000 + 160 * mpp(LANDING_DISTANCE, 900))
    expect(target.z).toBe(2000)
  })

  it('shifts the target north when the free band is below center, like frameBounds', () => {
    const { target } = frameInterior({ center, ...north, viewport, fovDeg: 35, free: { left: 0, top: 100, right: 1440, bottom: 900 } })
    expect(target.z).toBeCloseTo(2000 - (50 * mpp(LANDING_DISTANCE, 900)) / Math.cos(ISO_POLAR))
  })
})

describe('frameInterior at any azimuth', () => {
  const free = interiorFreeRect(viewport, insets, { left: 1136, top: 628, right: 1424, bottom: 884 })
  const midDepth = 8
  const towardCamera = midDepth * Math.tan(ISO_POLAR)

  /** Screen px of the mid-depth interior center for a real camera placed by the framing result. */
  function project(deg: number) {
    const azimuth = (deg * Math.PI) / 180
    const { distance, target } = frameInterior({ center, towardCamera, azimuth, viewport, free, fovDeg: 35 })
    const cam = new PerspectiveCamera(35, viewport.width / viewport.height, 1, 5000)
    const t = new Vector3(target.x, 0, target.z)
    cam.position.copy(t).add(new Vector3().setFromSphericalCoords(distance, ISO_POLAR, azimuth))
    cam.lookAt(t)
    cam.updateMatrixWorld()
    const p = new Vector3(center.x, -midDepth, center.z).project(cam)
    return { x: ((p.x + 1) / 2) * viewport.width, y: ((1 - p.y) / 2) * viewport.height }
  }

  it('lands the center near the free rect center (the shift is sized at target depth, so perspective leaves ~8%)', () => {
    const p = project(0)
    expect(Math.abs(p.x - (free.left + free.right) / 2)).toBeLessThan(15)
    expect(Math.abs(p.y - (free.top + free.bottom) / 2)).toBeLessThan(15)
  })

  it.each([-60, 45])('azimuth %i deg: projects to the same screen point as north-up', (deg) => {
    const rotated = project(deg)
    const flat = project(0)
    expect(rotated.x).toBeCloseTo(flat.x, 3)
    expect(rotated.y).toBeCloseTo(flat.y, 3)
  })
})

describe('landingAzimuth', () => {
  const phoneFree = interiorFreeRect({ width: 390, height: 844 }, { top: 96, bottom: 70 }, { left: 16, top: 525, right: 374, bottom: 770 })
  const deskFree = interiorFreeRect(viewport, insets, { left: 1136, top: 628, right: 1424, bottom: 884 })
  const alpha = LANDING_AXIS_OFF_VERTICAL
  /** The axis's angle off screen-vertical at azimuth θ, in [0, 90°]. */
  const offVertical = (v: readonly [number, number], theta: number) => {
    const right = v[0] * Math.cos(theta) - v[1] * Math.sin(theta)
    return Math.asin(Math.min(1, Math.abs(right)))
  }
  const turnOf = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)))

  it('allows 25 degrees off vertical: the largest that keeps every sz7 station framed on a phone (J20 needs it)', () => {
    expect(LANDING_AXIS_OFF_VERTICAL).toBeCloseTo((25 * Math.PI) / 180, 12)
  })

  it('keeps the azimuth when the free area is wider than tall in ground terms (desktop)', () => {
    expect(landingAzimuth([1, 0], 0.3, deskFree)).toBe(0.3)
  })

  it('on a phone turns an east-west platform to LANDING_AXIS_OFF_VERTICAL, the short way', () => {
    const az = landingAzimuth([1, 0], 0, phoneFree)
    expect(turnOf(az, 0)).toBeCloseTo(Math.PI / 2 - alpha, 9)
    expect(offVertical([1, 0], az)).toBeCloseTo(alpha, 9)
  })

  it('keeps the azimuth when the axis is already within LANDING_AXIS_OFF_VERTICAL of vertical', () => {
    expect(landingAzimuth([0, 1], 0, phoneFree)).toBe(0)
    const a = Math.PI / 2 - alpha + 0.01
    expect(landingAzimuth([Math.cos(a), Math.sin(a)], 0, phoneFree)).toBe(0)
  })

  it('turns at most 90° less the allowance and lands the axis at most that far off vertical', () => {
    for (const a of [0, 0.4, 1.2, 2, -0.7]) {
      const axis = [Math.cos(a), Math.sin(a)] as const
      for (const current of [0, 1, -2, 3]) {
        const az = landingAzimuth(axis, current, phoneFree)
        expect(turnOf(az, current)).toBeLessThanOrEqual(Math.PI / 2 - alpha + 1e-9)
        expect(offVertical(axis, az)).toBeLessThanOrEqual(alpha + 1e-9)
      }
    }
  })
})

describe('retargetTurn', () => {
  it('keeps a decided turn at any progress, so a retarget never re-picks it', () => {
    expect(retargetTurn(true, 0)).toBe('keep')
    expect(retargetTurn(true, 0.99)).toBe('keep')
  })

  it('decides when the interior arrives up to LATE_TURN_PROGRESS, and leaves it to the post-landing reframe after it', () => {
    expect(retargetTurn(false, 0.2)).toBe('decide')
    expect(retargetTurn(false, LATE_TURN_PROGRESS)).toBe('decide')
    expect(retargetTurn(false, LATE_TURN_PROGRESS + 0.01)).toBe('later')
  })
})
