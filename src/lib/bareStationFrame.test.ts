import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BARE_MAX_DISTANCE, bareStationFrame, FRAME_PAD_PX, TARGET_RADIUS_M, type BareStationFrameInput } from './bareStationFrame'
import type { Viewport } from './framing'
import { LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import { PAN_RADIUS_BARE } from './orbitLimits'
import type { Ground } from './projection'
import { tiltForDistance } from './tilt'

const FOV = 35
/** Off the origin, so a frame that ignored the station's position would show. */
const STATION: Ground = { x: 1200, z: -3400 }

/** Entrance offsets from the station point, meters (public/data/streets/<id>.json). */
const E127: [number, number][] = [
  [-62.8, 52.6], [-26.9, 74.7], [-15.4, -31.4], [-2.1, -93.7], [10.8, 4.7], [16.5, -117.8],
  [24.9, 12.3], [43.4, -56], [47.4, -63.6], [57.5, -63], [96.5, -33.1],
]
const E120: [number, number][] = [[-72.3, 93.7], [-63.8, 77.6], [-43.1, 109.7], [-34.6, 93.7], [7.6, -17.3], [23.1, -44.6]]

const PHONE: Viewport = { width: 390, height: 844 }
/** Measured on the app at 127 and 120: the station panel (six arrival rows and the entrances row) tops out at 265 px. */
const PHONE_FREE: ScreenRect = { left: 0, top: 60, right: 390, bottom: 249.5 }
/** The same phone with a three-row panel. */
const PHONE_SHORT_PANEL: ScreenRect = { left: 0, top: 60, right: 390, bottom: 430 }
const DESKS: [string, Viewport, ScreenRect][] = [
  ['1440x900', { width: 1440, height: 900 }, { left: 0, top: 60, right: 1120, bottom: 833 }],
  ['1280x720', { width: 1280, height: 720 }, { left: 0, top: 60, right: 960, bottom: 653 }],
]

const at = ([x, z]: [number, number]): Ground => ({ x: STATION.x + x, z: STATION.z + z })
const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

/** Screen px of a ground point for a camera posed as OrbitControls poses it, checked with three's own projection. */
function project(p: Ground, target: Ground, distance: number, azimuth: number, v: Viewport) {
  const polar = tiltForDistance(distance)
  const cam = new PerspectiveCamera(FOV, v.width / v.height, 1, 1e6)
  const back = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
  const t = new Vector3(target.x, 0, target.z)
  cam.position.copy(t).addScaledVector(back, distance)
  cam.lookAt(t)
  cam.updateMatrixWorld()
  const ndc = new Vector3(p.x, 0, p.z).project(cam)
  return { x: ((ndc.x + 1) / 2) * v.width, y: ((1 - ndc.y) / 2) * v.height }
}

function inside(p: Ground, input: BareStationFrameInput, f: { distance: number; target: Ground }, pad = 0): boolean {
  const s = project(p, f.target, f.distance, input.azimuth, input.viewport)
  const r = input.free
  const e = 1e-6
  return s.x >= r.left + pad - e && s.x <= r.right - pad + e && s.y >= r.top + pad - e && s.y <= r.bottom - pad + e
}

/** The target that puts the station mid-free at `distance` (found by the same projection, by Newton steps). */
function centered(input: BareStationFrameInput, distance: number): Ground {
  const r = input.free
  const goal = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
  const t = { ...input.station }
  for (let i = 0; i < 30; i++) {
    const s = project(input.station, t, distance, input.azimuth, input.viewport)
    const h = 0.01
    const sx = project(input.station, { x: t.x + h, z: t.z }, distance, input.azimuth, input.viewport)
    const sz = project(input.station, { x: t.x, z: t.z + h }, distance, input.azimuth, input.viewport)
    const [a, b, c, d] = [(sx.x - s.x) / h, (sz.x - s.x) / h, (sx.y - s.y) / h, (sz.y - s.y) / h]
    const ex = goal.x - s.x
    const ey = goal.y - s.y
    const det = a * d - b * c
    t.x += (d * ex - b * ey) / det
    t.z += (a * ey - c * ex) / det
  }
  return t
}

function input(points: Ground[], viewport: Viewport, free: ScreenRect, azimuth = 0): BareStationFrameInput {
  return { station: STATION, points, azimuth, viewport, free, fovDeg: FOV }
}

function expectBounded(i: BareStationFrameInput, f: { distance: number; target: Ground }) {
  expect(f.distance).toBeGreaterThanOrEqual(LANDING_DISTANCE)
  expect(f.distance).toBeLessThanOrEqual(BARE_MAX_DISTANCE)
  expect(gap(f.target, STATION)).toBeLessThanOrEqual(TARGET_RADIUS_M + 1e-6)
  expect(inside(STATION, i, f, FRAME_PAD_PX - 0.5)).toBe(true)
}

describe('bareStationFrame on a phone', () => {
  for (const azimuth of [0, 0.6]) {
    for (const [name, marks] of [['127', E127], ['120', E120]] as const) {
      it(`fits every entrance of ${name} above a three-row panel at azimuth ${azimuth}`, () => {
        const i = input(marks.map(at), PHONE, PHONE_SHORT_PANEL, azimuth)
        const f = bareStationFrame(i)
        expectBounded(i, f)
        for (const m of marks) expect(inside(at(m), i, f, FRAME_PAD_PX - 0.5)).toBe(true)
        // The orbit pivots on the station while it is within its pan radius of the free area's middle.
        expect(gap(f.target, centered(i, f.distance))).toBeLessThanOrEqual(PAN_RADIUS_BARE)
      })
    }
  }

  // The measured six-row panel leaves a 190 px strip: the 120 m target clamp binds at once (the centered target is
  // 138 m off) and leaves the station just above the strip's bottom, so 127's entrances, the nearest of which lie
  // south of it (below it on screen), are all dropped, and only 120's two north of it fit.
  const kept: [string, [number, number][], number, number][] = [
    ['127', E127, 0, 0],
    ['127', E127, 0.6, 0],
    ['120', E120, 0, 2],
    ['120', E120, 0.6, 2],
  ]
  for (const [name, marks, azimuth, n] of kept) {
    it(`keeps the station and its ${n} nearest entrances of ${name} above the tall panel at azimuth ${azimuth}`, () => {
      const i = input(marks.map(at), PHONE, PHONE_FREE, azimuth)
      const f = bareStationFrame(i)
      expectBounded(i, f)
      const nearest = marks.map(at).sort((a, b) => gap(a, STATION) - gap(b, STATION))
      for (const m of nearest.slice(0, n)) expect(inside(m, i, f, FRAME_PAD_PX - 0.5)).toBe(true)
      expect(gap(f.target, centered(i, f.distance))).toBeLessThanOrEqual(PAN_RADIUS_BARE)
    })
  }
})

describe('bareStationFrame on a desktop', () => {
  for (const [name, viewport, free] of DESKS) {
    for (const marks of [E127, E120]) {
      it(`stays at the landing distance and the centered target at ${name}`, () => {
        const i = input(marks.map(at), viewport, free, 0.6)
        const f = bareStationFrame(i)
        expect(f.distance).toBe(LANDING_DISTANCE)
        const t0 = centered(i, LANDING_DISTANCE)
        expect(f.target.x).toBeCloseTo(t0.x, 3)
        expect(f.target.z).toBeCloseTo(t0.z, 3)
        for (const m of marks) expect(inside(at(m), i, f)).toBe(true)
      })
    }
  }
})

describe('bareStationFrame with few entrances', () => {
  const cases: [string, Ground[]][] = [
    ['no entrances', []],
    ['one entrance near the station', [at([10.8, 4.7])]],
    // 300 m east can't fit with the target held near the station: it is dropped.
    ['one entrance too far to fit', [at([300, 0])]],
  ]
  for (const [name, points] of cases) {
    it(`lands centered at the landing distance with ${name}`, () => {
      const i = input(points, PHONE, PHONE_SHORT_PANEL, 0.6)
      const f = bareStationFrame(i)
      expectBounded(i, f)
      expect(f.distance).toBe(LANDING_DISTANCE)
      const t0 = centered(i, LANDING_DISTANCE)
      expect(f.target.x).toBeCloseTo(t0.x, 3)
      expect(f.target.z).toBeCloseTo(t0.z, 3)
    })
  }

  it('pulls a centered target farther than the clamp back within it, the station still inside', () => {
    const i = input([at([300, 0])], PHONE, PHONE_FREE)
    expect(gap(centered(i, LANDING_DISTANCE), STATION)).toBeGreaterThan(TARGET_RADIUS_M)
    const f = bareStationFrame(i)
    expectBounded(i, f)
    expect(inside(at([300, 0]), i, f)).toBe(false)
  })
})
