import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { BARE_MAX_DISTANCE, bareStationFrame, bareTargetAt, FRAME_PAD_PX, type BareStationFrame, type BareStationFrameInput } from './bareStationFrame'
import type { Viewport } from './framing'
import { LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import { PAN_RADIUS_BARE } from './orbitLimits'
import type { Ground } from './projection'
import { tiltForDistance } from './tilt'

const FOV = 35
/** Off the origin, so a frame that ignored the station's position would show. */
const STATION: Ground = { x: 1200, z: -3400 }

type Offset = [number, number]
/** Entrance offsets from the station point, meters (public/data/streets/<id>.json). */
const E127: Offset[] = [
  [-62.8, 52.6], [-26.9, 74.7], [-15.4, -31.4], [-2.1, -93.7], [10.8, 4.7], [16.5, -117.8],
  [24.9, 12.3], [43.4, -56], [47.4, -63.6], [57.5, -63], [96.5, -33.1],
]
const E120: Offset[] = [[-72.3, 93.7], [-63.8, 77.6], [-43.1, 109.7], [-34.6, 93.7], [7.6, -17.3], [23.1, -44.6]]
/** 127's neighbours within 200 m (stations.json): 725 (its Times Sq sibling, 27 m), 902 and R16. 120 has none. */
const N127: Offset[] = [[-16.9, -21.1], [106.2, -76.7], [62.4, 68.9]]

const PHONE: Viewport = { width: 390, height: 844 }
/** Measured on the app at 127 and 120 with live arrivals: six rows and the entrances row top out at 265 px. */
const PHONE_LIVE: ScreenRect = { left: 0, top: 60, right: 390, bottom: 249.5 }
/** The same phone with a three-row panel. */
const PHONE_SHORT: ScreenRect = { left: 0, top: 60, right: 390, bottom: 430 }
/** Measured with no live data: the panel holds one line. */
const PHONE_ONE_LINE: ScreenRect = { left: 0, top: 60, right: 390, bottom: 510.5 }
const DESKS: [string, Viewport, ScreenRect][] = [
  ['1440x900', { width: 1440, height: 900 }, { left: 0, top: 60, right: 1120, bottom: 833 }],
  ['1280x720', { width: 1280, height: 720 }, { left: 0, top: 60, right: 960, bottom: 653 }],
]
/** Looking from the side of 725: the plain landing target would sit nearer 725 than 127. */
const TOWARD_725 = Math.atan2(-16.9, -21.1)

const at = ([x, z]: Offset): Ground => ({ x: STATION.x + x, z: STATION.z + z })
const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)

/** Screen px of a ground point for a camera posed as OrbitControls poses it, checked with three's own projection. */
function project(p: Ground, f: BareStationFrame, azimuth: number, v: Viewport) {
  const polar = tiltForDistance(f.distance)
  const cam = new PerspectiveCamera(FOV, v.width / v.height, 1, 1e6)
  const back = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
  const t = new Vector3(f.target.x, 0, f.target.z)
  cam.position.copy(t).addScaledVector(back, f.distance)
  cam.lookAt(t)
  cam.updateMatrixWorld()
  const ndc = new Vector3(p.x, 0, p.z).project(cam)
  return { x: ((ndc.x + 1) / 2) * v.width, y: ((1 - ndc.y) / 2) * v.height }
}

function inside(p: Ground, i: BareStationFrameInput, f: BareStationFrame, pad = 0): boolean {
  const s = project(p, f, i.azimuth, i.viewport)
  const r = i.free
  const e = 1e-6
  return s.x >= r.left + pad - e && s.x <= r.right - pad + e && s.y >= r.top + pad - e && s.y <= r.bottom - pad + e
}

/** The target that puts the station mid-free at `distance`, found by Newton steps on the same projection. */
function centered(i: BareStationFrameInput, distance: number): Ground {
  const r = i.free
  const goal = { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }
  const t = { ...i.station }
  const px = (x: number, z: number) => project(i.station, { distance, target: { x, z } }, i.azimuth, i.viewport)
  for (let k = 0; k < 30; k++) {
    const s = px(t.x, t.z)
    const sx = px(t.x + 0.01, t.z)
    const sz = px(t.x, t.z + 0.01)
    const [a, b, c, d] = [(sx.x - s.x) / 0.01, (sz.x - s.x) / 0.01, (sx.y - s.y) / 0.01, (sz.y - s.y) / 0.01]
    const det = a * d - b * c
    t.x += (d * (goal.x - s.x) - b * (goal.y - s.y)) / det
    t.z += (a * (goal.y - s.y) - c * (goal.x - s.x)) / det
  }
  return t
}

function input(points: Ground[], free: ScreenRect, azimuth: number, others: readonly Offset[] = [], viewport = PHONE): BareStationFrameInput {
  return { station: STATION, points, others: others.map(at), azimuth, viewport, free, fovDeg: FOV }
}

/** Whether any distance in range has a target for these points. */
function fitsAnywhere(i: BareStationFrameInput, points: Ground[], strict = true): boolean {
  for (let d = LANDING_DISTANCE; d <= BARE_MAX_DISTANCE; d += 10) if (bareTargetAt(i, points, d, strict)) return true
  return false
}

const PAD = FRAME_PAD_PX - 0.5

function expectBounded(f: BareStationFrame) {
  expect(f.distance).toBeGreaterThanOrEqual(LANDING_DISTANCE)
  expect(f.distance).toBeLessThanOrEqual(BARE_MAX_DISTANCE)
  expect(gap(f.target, STATION)).toBeLessThanOrEqual(PAN_RADIUS_BARE)
}

/** Every entrance it shows fits with every one it doesn't: none was skipped that could have joined. */
function expectMaximal(i: BareStationFrameInput, f: BareStationFrame) {
  const shown = i.points.filter((p) => inside(p, i, f, PAD))
  for (const p of i.points.filter((q) => !shown.includes(q))) expect(fitsAnywhere(i, [...shown, p])).toBe(false)
  return shown.length
}

describe('bareStationFrame above a three-row phone panel', () => {
  const cases: [string, Offset[], Offset[], number, number][] = [
    // name, entrances, neighbours, azimuth, entrances shown
    ['120', E120, [], 0, 5],
    ['120', E120, [], 0.6, 6],
    ['120', E120, [], TOWARD_725, 6],
    ['127', E127, N127, 0, 10],
    ['127', E127, N127, 0.6, 9],
    // 725 is 27 m off: from its side the target can't stay nearer 127 with 127 in view, so that limit gives way.
    ['127', E127, N127, TOWARD_725, 11],
  ]
  for (const [name, marks, others, azimuth, shown] of cases) {
    it(`shows the station and ${shown} of ${name}'s entrances at azimuth ${azimuth.toFixed(2)}, none it could have`, () => {
      const i = input(marks.map(at), PHONE_SHORT, azimuth, others)
      const f = bareStationFrame(i)
      expectBounded(f)
      expect(inside(STATION, i, f, PAD)).toBe(true)
      expect(expectMaximal(i, f)).toBe(shown)
      // The orbit pivots on the station while it is within its pan radius of the free area's middle.
      expect(gap(f.target, centered(i, f.distance))).toBeLessThanOrEqual(PAN_RADIUS_BARE)
      if (azimuth !== TOWARD_725) for (const o of others) expect(gap(f.target, STATION)).toBeLessThan(gap(f.target, at(o)))
    })
  }

  it('pulls back only as far as it must: 127 at azimuth 0.6 lands past 400 m, and 10 m nearer does not fit', () => {
    const i = input(E127.map(at), PHONE_SHORT, 0.6, N127)
    const f = bareStationFrame(i)
    expect(f.distance).toBeGreaterThan(LANDING_DISTANCE)
    const shown = i.points.filter((p) => inside(p, i, f, PAD))
    expect(bareTargetAt(i, shown, f.distance - 10)).toBeNull()
  })

  it('pulls back for 127 at azimuth 0 too, and not 10 m less', () => {
    const i = input(E127.map(at), PHONE_SHORT, 0, N127)
    const f = bareStationFrame(i)
    expect(f.distance).toBeGreaterThan(LANDING_DISTANCE)
    expect(bareTargetAt(i, i.points.filter((p) => inside(p, i, f, PAD)), f.distance - 10)).toBeNull()
  })

  it('keeps the target nearer 127 than R16, which the plain landing is nearer', () => {
    const i = input(E127.map(at), PHONE_SHORT, 0, N127)
    const r16 = at(N127[2]!)
    const t0 = centered(i, LANDING_DISTANCE)
    expect(gap(t0, r16)).toBeLessThan(gap(t0, STATION))
    const loose = bareStationFrame({ ...i, others: [] })
    expect(gap(loose.target, r16)).toBeLessThan(gap(loose.target, STATION))
    const f = bareStationFrame(i)
    for (const o of N127) expect(gap(f.target, STATION)).toBeLessThan(gap(f.target, at(o)))
  })

  it("gives way to 725, 27 m off, rather than lose the station from the free area when looking from 725's side", () => {
    const i = input(E127.map(at), PHONE_SHORT, TOWARD_725, N127)
    expect(fitsAnywhere(i, [], true)).toBe(false)
    const f = bareStationFrame(i)
    expect(inside(STATION, i, f, PAD)).toBe(true)
    expect(gap(f.target, at(N127[0]!))).toBeLessThan(gap(f.target, STATION))
  })
})

describe('bareStationFrame above the live six-row phone panel', () => {
  // The 190 px strip leaves no target within PAN_RADIUS_BARE that keeps the station inside it (the plain landing's is
  // 138 m off), so the landing is that target pulled to the radius and the station sits just under the strip.
  for (const [name, marks, others] of [['127', E127, N127], ['120', E120, []]] as const) {
    it(`pulls the plain landing at ${name} to ${PAN_RADIUS_BARE} m, since not even the station fits`, () => {
      const i = input(marks.map(at), PHONE_LIVE, 0, others)
      expect(fitsAnywhere(i, [], false)).toBe(false)
      const f = bareStationFrame(i)
      expect(f.distance).toBe(LANDING_DISTANCE)
      const t0 = centered(i, LANDING_DISTANCE)
      expect(gap(t0, STATION)).toBeGreaterThan(130)
      expect(gap(f.target, STATION)).toBeGreaterThan(PAN_RADIUS_BARE * Math.cos(Math.PI / 16) - 1e-6)
      expect(gap(f.target, STATION)).toBeLessThanOrEqual(PAN_RADIUS_BARE)
      const dir = (p: Ground) => Math.atan2(p.x - STATION.x, p.z - STATION.z)
      expect(Math.abs(dir(f.target) - dir(t0))).toBeLessThan(0.2)
      const s = project(STATION, f, 0, PHONE)
      expect(s.y).toBeGreaterThan(PHONE_LIVE.bottom)
      expect(s.y).toBeLessThan(PHONE_LIVE.bottom + 20)
    })
  }
})

describe('bareStationFrame on a desktop', () => {
  for (const [name, viewport, free] of DESKS) {
    for (const [marks, others] of [[E127, N127], [E120, []]] as const) {
      it(`stays at the landing distance and the centred target at ${name}`, () => {
        const i = input(marks.map(at), free, 0.6, others, viewport)
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
  const near = at([10.8, 4.7])
  const cases: [string, Ground[]][] = [
    ['no entrances', []],
    ['one entrance near the station', [near]],
    ['one entrance 300 m east', [at([300, 0])]],
  ]
  for (const [name, points] of cases) {
    it(`lands centred at the landing distance with ${name}`, () => {
      const i = input(points, PHONE_ONE_LINE, 0.6)
      const f = bareStationFrame(i)
      expectBounded(f)
      expect(f.distance).toBe(LANDING_DISTANCE)
      const t0 = centered(i, LANDING_DISTANCE)
      expect(f.target.x).toBeCloseTo(t0.x, 3)
      expect(f.target.z).toBeCloseTo(t0.z, 3)
    })
  }

  it('skips an entrance that would need more than 600 m and keeps the nearer one', () => {
    const far = at([200, 0])
    const i = input([far, near], PHONE_SHORT, 0)
    expect(bareTargetAt(i, [far], BARE_MAX_DISTANCE)).toBeNull()
    const f = bareStationFrame(i)
    expect(f.distance).toBe(LANDING_DISTANCE)
    expect(inside(near, i, f, PAD)).toBe(true)
    expect(inside(far, i, f)).toBe(false)
  })
})
