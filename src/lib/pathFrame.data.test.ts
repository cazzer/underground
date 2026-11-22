/**
 * The trip's path framed above a phone's trip panel on committed interiors: the way out at Bedford Av (authored),
 * Graham Av (generated) and Union Sq (the complex), and changes of trains at Union Sq. Free rects measured on the app with the trip panel open on a one-journey trip (its
 * expanded legs and the exit line), at 390×844 and 375×812.
 */
import { readFileSync } from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../data/stationSchema'
import { quickestExit } from './exitChoice'
import { chooseTransfer } from './interiorTransfer'
import { stationPathFrameOf, pathLanding, type PathFrame } from './pathFrame'
import { framedCount, FRAME_MAX_DISTANCE, FRAME_PAD_PX, TARGET_RADIUS_M, type FreeFrame } from './freeFrame'
import type { Viewport } from './framing'
import { stationAxis } from './interiorAxis'
import { frameInterior, landingAzimuth, LANDING_DISTANCE, type ScreenRect } from './interiorCamera'
import { RAIL_DROP_M } from './interiorGeometry'
import { interiorFocusAnchor } from './interiorFraming'
import { BOARD_HALF_M } from './interiorPath'
import { toGround, type Ground } from './projection'
import { depthFactor, ISO_POLAR, tiltForDistance } from './tilt'

const FOV = 35
interface View {
  azimuth: number
  viewport: Viewport
  free: ScreenRect
  fovDeg: number
}
type Landing = Pick<FreeFrame, 'distance' | 'target'>
const Y = 2
const stations = JSON.parse(readFileSync('public/data/stations.json', 'utf8')).stations as { id: string; lat: number; lon: number }[]
const pos = new Map(stations.map((s) => [s.id, toGround(s)]))
const PHONES: [string, Viewport, ScreenRect][] = [
  ['390x844', { width: 390, height: 844 }, { left: 0, top: 60, right: 390, bottom: 302.5 }],
  ['375x812', { width: 375, height: 812 }, { left: 0, top: 60, right: 375, bottom: 270.5 }],
]

/** The quickest way out from `stopId`, or with `toStop` the change of trains to it. */
function pathAt(id: string, stopId: string, toStop?: string): { frame: PathFrame; interior: StationInterior; plain: (view: View) => Landing } {
  const interior = JSON.parse(readFileSync(`public/data/stations/${id}.json`, 'utf8')) as StationInterior
  const origin = toGround(interior.anchor)
  const model = { stationId: interior.stationId, interior, origin, yScale: Y, focusAnchor: interiorFocusAnchor(origin, interior, Y, Math.tan(ISO_POLAR)) }
  const choice = toStop ? chooseTransfer({ interior, fromStop: stopId, toStop }) : quickestExit({ interior, stopId })
  if (choice.kind === 'none') throw new Error(`${stopId}: no path`)
  const anchors = (interior.memberStationIds ?? [interior.stationId]).map((m) => pos.get(m)!)
  const frame = stationPathFrameOf(model, choice, anchors, { stepRise: 0.18, railDrop: RAIL_DROP_M, boardHalfM: BOARD_HALF_M })
  if (!frame) throw new Error(`${stopId}: no frame`)
  return { frame, interior, plain: (view) => frameInterior({ ...model.focusAnchor, ...view }) }
}

/** Screen px of a drawn point (y at the depth factor) for a camera posed as OrbitControls poses it, by three's projection. */
function project(p: { x: number; y: number; z: number }, f: Landing, azimuth: number, v: Viewport) {
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

const gap = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)
const PAD = FRAME_PAD_PX - 0.5

describe('the way out above a phone trip panel', () => {
  for (const [name, viewport, free] of PHONES) {
    const whole: [string, string, string?][] = [
      ['L08', 'L08N'],
      ['L08', 'L08S'],
      ['L11', 'L11N'],
      ['L11', 'L11S'],
      ['635', 'R20N'],
      ['635', 'R20S'],
      // Changes between the Lexington and Broadway platforms: both markers and the walk between them.
      ['635', '635N', 'R20N'],
      ['635', '635S', 'R20S'],
      ['635', 'R20N', '635S'],
      ['635', 'R20S', '635N'],
    ]
    for (const [id, stopId, toStop] of whole) {
      it(`lands with the whole path from ${stopId}${toStop ? ` to ${toStop}` : ''} at ${id} above the panel on ${name}`, () => {
        const { frame, interior, plain } = pathAt(id, stopId, toStop)
        const view = { azimuth: landingAzimuth(stationAxis(interior), 0, free), viewport, free, fovDeg: FOV }
        const f = pathLanding(frame, view, plain(view))
        expect(f.distance).toBeGreaterThanOrEqual(LANDING_DISTANCE)
        expect(f.distance).toBeLessThanOrEqual(FRAME_MAX_DISTANCE)
        // Either the usual landing (it already shows the path) or one held near a member.
        if (f !== plain(view) && JSON.stringify(f) !== JSON.stringify(plain(view))) {
          expect(Math.min(...frame.anchors.map((a) => gap(a, f.target)))).toBeLessThanOrEqual(TARGET_RADIUS_M + 1e-6)
        }
        const path = frame.wanted.slice(0, frame.pathCount)
        expect(framedCount(view, f, path)).toBe(path.length)
        for (const p of path) {
          const s = project(p, f, view.azimuth, viewport)
          expect(s.x).toBeGreaterThanOrEqual(free.left + PAD)
          expect(s.x).toBeLessThanOrEqual(free.right - PAD)
          expect(s.y).toBeGreaterThanOrEqual(free.top + PAD)
          expect(s.y).toBeLessThanOrEqual(free.bottom - PAD)
        }
      })
    }

    // The Lexington and Canarsie platforms' ways out, and changes to or from the L: above a phone panel the target
    // would have to sit over 200 m from every member's point (TARGET_RADIUS_M is 100), so these land as usual and part
    // of the path stays under the panel.
    const partial: [string, string?][] = [['635N'], ['635S'], ['L03N'], ['L03S'], ['L03N', '635S'], ['635N', 'L03N'], ['L03S', 'R20N']]
    for (const [stopId, toStop] of partial) {
      it(`lands as usual for the path from ${stopId}${toStop ? ` to ${toStop}` : ''} at Union Sq on ${name}`, () => {
        const { frame, interior, plain } = pathAt('635', stopId, toStop)
        const view = { azimuth: landingAzimuth(stationAxis(interior), 0, free), viewport, free, fovDeg: FOV }
        const usual = plain(view)
        expect(pathLanding(frame, view, usual)).toBe(usual)
        expect(framedCount(view, usual, frame.wanted.slice(0, frame.pathCount))).toBeLessThan(frame.pathCount)
      })
    }
  }
})
