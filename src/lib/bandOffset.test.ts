import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  BAND_FADE_FAR_M,
  BAND_FADE_NEAR_M,
  bandPitchAt,
  bandShift,
  createBandView,
  trackSplit,
  writeBandView,
  type BandView,
} from './bandOffset'

const W = 390
const H = 844
const PITCH = 2.5
const OFFSET = 4.7

/** The app's camera (fov 35) `distance` from `target`, tilted `polarDeg` from top-down, turned `azimuthDeg`. */
function camera(target: Vector3, distance: number, polarDeg: number, azimuthDeg: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(35, W / H, 10, 1e6)
  const polar = (polarDeg * Math.PI) / 180
  const az = (azimuthDeg * Math.PI) / 180
  // OrbitControls' spherical: y up, azimuth about y, 0 looking north (camera south of the target).
  cam.position.set(
    target.x + distance * Math.sin(polar) * Math.sin(az),
    target.y + distance * Math.cos(polar),
    target.z + distance * Math.sin(polar) * Math.cos(az),
  )
  cam.up.set(0, 0, -1)
  if (polarDeg > 0) cam.up.set(0, 1, 0)
  cam.lookAt(target)
  cam.updateMatrixWorld()
  return cam
}

/** The view `cam` gives; trackOffsetM 0 leaves only the band term. */
function viewOf(cam: PerspectiveCamera, distance: number, offset = 0): BandView {
  return writeBandView(createBandView(), cam.matrixWorldInverse.elements, cam.projectionMatrix.elements[5]!, H, distance, PITCH, offset)
}

function toPx(cam: PerspectiveCamera, p: Vector3): [number, number] {
  const ndc = p.clone().project(cam)
  return [((ndc.x + 1) / 2) * W, ((1 - ndc.y) / 2) * H]
}

/** Screen distance in pixels from c to the line through a and b. */
function pxToLine(a: [number, number], b: [number, number], c: [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  return Math.abs(dx * (c[1] - a[1]) - dy * (c[0] - a[0])) / Math.hypot(dx, dy)
}

describe('bandShift', () => {
  const target = new Vector3(1200, 0, -800)
  for (const polar of [0, 30, 54.7]) {
    for (const azimuth of [0, 30, -45, 120]) {
      for (const headingDeg of [0, 29, 75, 135]) {
        it(`puts band 1 a pitch away on screen (polar ${polar}, azimuth ${azimuth}, heading ${headingDeg})`, () => {
          const distance = 1500
          const cam = camera(target, distance, polar, azimuth)
          const view = viewOf(cam, distance)
          const h = (headingDeg * Math.PI) / 180
          // Tangent (heading clockwise from north) and its right normal (-tz, tx).
          const t = new Vector3(Math.sin(h), 0, -Math.cos(h))
          const n = new Vector3(-t.z, 0, t.x)
          // At the view center and off toward a corner of the screen.
          for (const at of [target, target.clone().add(new Vector3(250, 0, 180))]) {
            const s = bandShift(view, at.x, at.y, at.z, n.x, n.z, 1, 0)
            const a = toPx(cam, at)
            const b = toPx(cam, at.clone().addScaledVector(t, 20))
            const shifted = toPx(cam, at.clone().addScaledVector(n, s))
            expect(pxToLine(a, b, shifted)).toBeGreaterThan(PITCH * 0.9)
            expect(pxToLine(a, b, shifted)).toBeLessThan(PITCH * 1.1)
          }
        })
      }
    }
  }

  it('scales with the band and the miter, and is signed right of travel', () => {
    const cam = camera(target, 1500, 30, 0)
    const view = viewOf(cam, 1500)
    const one = bandShift(view, target.x, 0, target.z, 1, 0, 1, 0)
    expect(one).toBeGreaterThan(0)
    expect(bandShift(view, target.x, 0, target.z, 1, 0, -1.5, 0)).toBeCloseTo(-1.5 * one)
    // A miter vector 1.25 long: the shift along the unit normal grows by the miter factor.
    expect(bandShift(view, target.x, 0, target.z, 1.25, 0, 1, 0)).toBeCloseTo(1.25 * one)
  })

  // Top-down at the view center one pixel is k * distance meters, so the tracks are 2 * OFFSET / (k * d) px apart.
  const k = 2 / (camera(target, 1000, 0, 0).projectionMatrix.elements[5]! * H)
  const distanceFor = (gapPx: number) => (2 * OFFSET) / (gapPx * k)

  it('moves a point back onto the centerline while the direction tracks are under 5 px apart, not from 10 px', () => {
    const merged = distanceFor(4)
    expect(bandShift(viewOf(camera(target, merged, 0, 0), merged, OFFSET), target.x, 0, target.z, 0, 1.5, 0, 0)).toBeCloseTo(-OFFSET * 1.5)
    const apart = distanceFor(11)
    expect(bandShift(viewOf(camera(target, apart, 0, 0), apart, OFFSET), target.x, 0, target.z, 0, 1.5, 0, 0)).toBeCloseTo(0, 9)
  })

  it('keeps a wide corridor merged until both bundles fit side by side', () => {
    // 12 px apart: a lone route is split; a corridor 2 slots either side (10 px of bands) is still merged.
    const d = distanceFor(12)
    const view = viewOf(camera(target, d, 0, 0), d, OFFSET)
    expect(bandShift(view, target.x, 0, target.z, 0, 1, 0, 0)).toBeCloseTo(0, 9)
    expect(bandShift(view, target.x, 0, target.z, 0, 1, 0, 2)).toBeCloseTo(-OFFSET)
  })
})

describe('writeBandView', () => {
  it('fades the pitch out across the overview', () => {
    expect(bandPitchAt(BAND_FADE_NEAR_M, PITCH)).toBe(PITCH)
    expect(bandPitchAt(1_000, PITCH)).toBe(PITCH)
    expect(bandPitchAt(BAND_FADE_FAR_M, PITCH)).toBe(0)
    const mid = bandPitchAt((BAND_FADE_NEAR_M + BAND_FADE_FAR_M) / 2, PITCH)
    expect(mid).toBeGreaterThan(0)
    expect(mid).toBeLessThan(PITCH)
  })

  it('splits the direction tracks across 5 to 10 px, later by the width of a bundle', () => {
    expect(trackSplit(4, 0)).toBe(0)
    expect(trackSplit(7.5, 0)).toBeCloseTo(0.5)
    expect(trackSplit(11, 0)).toBe(1)
    expect(trackSplit(10, 5)).toBe(0)
    expect(trackSplit(15, 5)).toBe(1)
  })
})
