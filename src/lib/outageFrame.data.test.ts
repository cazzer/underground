/**
 * The machines out of service at Pelham Pkwy (211) framed above a phone's station panel. Its elevators and escalators
 * are all at the station house at the south end, 70 to 100 m from the plan center. Free rects measured on the app with
 * `?ene=EL136,EL137,EL138,ES122,ES123` and live arrivals: the panel as it lands (two outage rows and "Show 3 more"), and
 * with the list expanded, which leaves 32 px above it. The landing stays as usual and none of them shows above the
 * panel; collapsing the panel to its bar (2q7.34) shows them all.
 */
import { readFileSync } from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../data/stationSchema'
import { framedCount, FRAME_PAD_PX, type FramePoint, type FreeFrame } from './freeFrame'
import type { Viewport } from './framing'
import { stationAxis } from './interiorAxis'
import { frameInterior, landingAzimuth, type ScreenRect } from './interiorCamera'
import { RAIL_DROP_M, STEP_RISE_M } from './interiorGeometry'
import { interiorFocusAnchor } from './interiorFraming'
import { BOARD_HALF_M } from './interiorPath'
import { outageFramePoints } from './outageFrame'
import { collapsedLanding, PHONE_COLLAPSED } from './collapseFixture'
import { reframeGains } from './collapseReframe'
import { priorityFrameOf, priorityLanding, priorityTiers } from './pathFrame'
import { toGround } from './projection'
import { depthFactor, ISO_POLAR, tiltForDistance } from './tilt'

const FOV = 35
const Y = 2
type Landing = Pick<FreeFrame, 'distance' | 'target'>
const stations = JSON.parse(readFileSync('public/data/stations.json', 'utf8')).stations as { id: string; lat: number; lon: number }[]
const interior = JSON.parse(readFileSync('public/data/stations/211.json', 'utf8')) as StationInterior
const origin = toGround(interior.anchor)
const model = { stationId: '211', interior, origin, yScale: Y, focusAnchor: interiorFocusAnchor(origin, interior, Y, Math.tan(ISO_POLAR)) }
const station = toGround(stations.find((s) => s.id === '211')!)
const outages = outageFramePoints(model, ['EL136', 'EL137', 'EL138', 'ES122', 'ES123'], Y)
const frame = priorityFrameOf(model, null, outages, [station], { stepRise: STEP_RISE_M, railDrop: RAIL_DROP_M, boardHalfM: BOARD_HALF_M })!
const plainOf = (view: { azimuth: number; viewport: Viewport; free: ScreenRect; fovDeg: number }) => frameInterior({ ...model.focusAnchor, ...view })

/** Screen px of a drawn point (y at the depth factor) for a camera posed as OrbitControls poses it, by three's projection. */
function project(p: FramePoint, f: Landing, azimuth: number, v: Viewport) {
  const polar = tiltForDistance(f.distance)
  const cam = new PerspectiveCamera(FOV, v.width / v.height, 1, 1e6)
  const back = new Vector3(Math.sin(polar) * Math.sin(azimuth), Math.cos(polar), Math.sin(polar) * Math.cos(azimuth))
  const t = new Vector3(f.target.x, 0, f.target.z)
  cam.position.copy(t).addScaledVector(back, f.distance)
  cam.lookAt(t)
  cam.updateMatrixWorld()
  const ndc = new Vector3(p.x, p.y * depthFactor(f.distance), p.z).project(cam)
  return { x: ((ndc.x + 1) / 2) * v.width, y: ((1 - ndc.y) / 2) * v.height }
}

const PAD = FRAME_PAD_PX - 0.5
const PHONES: [string, Viewport, number, number][] = [
  // Viewport, then the free area's bottom as it lands and with the list expanded (panel top - 16).
  ['390x844', { width: 390, height: 844 }, 185.5, 92],
  ['375x812', { width: 375, height: 812 }, 153.5, 92],
]

describe('the machines out of service at Pelham Pkwy above a phone station panel', () => {
  it('finds the machines in the interior', () => {
    expect(outages.length).toBeGreaterThan(0)
  })

  for (const [name, viewport, bottom, expanded] of PHONES) {
    const free = { left: 0, top: 60, right: viewport.width, bottom }
    const view = { azimuth: landingAzimuth(stationAxis(interior), 0, free), viewport, free, fovDeg: FOV }

    it(`never frames fewer machines than the usual landing on ${name}`, () => {
      // Looking north the station house sits under the panel, and (with the measured panel) no target within reach of
      // the station lifts it out, so this lands as usual; collapsing the panel is what shows it.
      const plain = plainOf(view)
      expect(framedCount(view, priorityLanding(frame, view, plain), outages)).toBeGreaterThanOrEqual(framedCount(view, plain, outages))
    })

    it(`shows no fewer machines once the list is expanded on ${name}`, () => {
      // 32 px above the panel: no landing shows them all, but the reframe (no turn) never shows fewer than the plain one.
      const tall = { ...view, free: { ...free, bottom: expanded } }
      const plain = plainOf(tall)
      expect(framedCount(tall, priorityLanding(frame, tall, plain), outages)).toBeGreaterThanOrEqual(framedCount(tall, plain, outages))
    })
  }

  it('frames every machine above the collapsed bar on 390x844, where the landing already shows them: no move', () => {
    const viewport = PHONE_COLLAPSED.viewport
    const open = { left: 0, top: 60, right: 390, bottom: PHONES[0]![2] }
    const azimuth = landingAzimuth(stationAxis(interior), 0, open)
    const openView = { azimuth, viewport, free: open, fovDeg: FOV }
    const landed = priorityLanding(frame, openView, plainOf(openView))
    const { view, next } = collapsedLanding(frame, plainOf, azimuth)
    const tiers = priorityTiers(frame)
    const counts = (v: typeof view, l: Landing) => tiers.map((t) => framedCount(v, l, t))
    expect(reframeGains(counts(view, landed), counts(view, next), tiers.map((t) => t.length))).toBe(false)
    for (const p of outages) {
      const s = project(p, landed, azimuth, viewport)
      expect(s.x).toBeGreaterThanOrEqual(PHONE_COLLAPSED.free.left + PAD)
      expect(s.x).toBeLessThanOrEqual(PHONE_COLLAPSED.free.right - PAD)
      expect(s.y).toBeGreaterThanOrEqual(PHONE_COLLAPSED.free.top + PAD)
      expect(s.y).toBeLessThanOrEqual(PHONE_COLLAPSED.free.bottom - PAD)
    }
  })

  it('keeps the usual landing on a desktop, where the whole interior fits beside the panel, and a collapse frees no room there', () => {
    const viewport = { width: 1440, height: 900 }
    const free = { left: 0, top: 60, right: 1120, bottom: 833 }
    const view = { azimuth: landingAzimuth(stationAxis(interior), 0, free), viewport, free, fovDeg: FOV }
    const plain = plainOf(view)
    expect(framedCount(view, plain, outages)).toBe(outages.length)
    expect(priorityLanding(frame, view, plain)).toBe(plain)
    const tiers = priorityTiers(frame)
    const counts = tiers.map((t) => framedCount(view, plain, t))
    expect(reframeGains(counts, counts, tiers.map((t) => t.length))).toBe(false)
  })
})
