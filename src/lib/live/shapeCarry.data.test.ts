/**
 * Shape changes replayed on the committed public/data with its real bands: every pair of one route and direction's
 * shapes, sampled around three banded junctions, as a train on one moves to the other at 600 m (the app's tilt, a
 * phone's 390 x 844 canvas). The ground-line projection jumped a band pitch or more on screen there; the drawn one
 * (shapeCarry.ts) must not jump, nor step more than 1 px a frame while the gap eases out.
 */
import { describe, expect, it } from 'vitest'
import routesRaw from '../../../public/data/routes.json?raw'
import depthsRaw from '../../../public/data/station-depths.json?raw'
import shapesRaw from '../../../public/data/shapes.json?raw'
import stationsRaw from '../../../public/data/stations.json?raw'
import type { RoutesFile, ShapesFile, StationsFile } from '../../data/schema'
import type { PackedDepthsFile } from '../../data/stationSchema'
import { buildNetwork, type ShapePath } from '../network'
import { bandNetwork } from '../networkBands'
import { pointAtDistance, projectForward } from '../realtime/polyline'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { TRACK_OFFSET_M } from '../trackOffset'
import { pxApart, replay, viewAt } from './carryReplay'
import { CARRY_M } from './shapeCarry'
import { createTrackPoint, nearestOnTrack, trackPointInto } from './trackPoint'

const network = buildNetwork(
  JSON.parse(stationsRaw) as StationsFile,
  JSON.parse(routesRaw) as RoutesFile,
  JSON.parse(shapesRaw) as ShapesFile,
  TRACK_OFFSET_M,
  JSON.parse(depthsRaw) as PackedDepthsFile,
  2,
)
const { shapes } = bandNetwork(network)

const geometryOf = (s: ShapePath): ShapeGeometry => ({
  shapeId: s.id,
  line: s,
  stops: ['x', 'y'],
  stopDistances: [0, s.length],
  maxStopOffsetM: 0,
  profile: s.profile,
  bandInputs: s.bandInputs,
})

const STEP_M = 150
const RADIUS_M = 500
const DISTANCE = 600

/** DeKalb Av, W 4 St and 34 St-Herald Sq: where several routes split and merge on banded track. */
const JUNCTIONS = ['R30', 'D20', 'R17'].map((id) => network.stationById.get(id)!.pos)

describe('real public/data: shape changes at banded junctions', () => {
  it('carries trains over with no jump above 1 px and no frame step above 1 px', () => {
    const groups = new Map<string, ShapePath[]>()
    for (const s of shapes) {
      const k = `${s.routeId}/${s.direction}`
      groups.set(k, [...(groups.get(k) ?? []), s])
    }
    const near = (p: { x: number; z: number }) => JUNCTIONS.some((j) => Math.hypot(p.x - j.x, p.z - j.z) < RADIUS_M)
    const p = createTrackPoint()
    const q = createTrackPoint()
    const hit = { distance: 0, offsetM: 0 }
    let carried = 0
    let groundJumps = 0
    let worst = { jumpPx: 0, stepPx: 0, endPx: 0 }
    for (const group of groups.values()) {
      for (const a of group) {
        for (const b of group) {
          if (a === b) continue
          const from = geometryOf(a)
          const to = geometryOf(b)
          for (let d = 0; d < a.length; d += STEP_M) {
            const ground = pointAtDistance(a, d).point
            if (!near(ground)) continue
            const v = viewAt(ground, DISTANCE)
            trackPointInto(from, d, v, p)
            if (nearestOnTrack(to, p, v, hit).offsetM > CARRY_M) continue
            // The old way: the ground point projected onto the new ground line, drawn there.
            const old = projectForward(b, ground, { segment: 0, t: 0 })
            const oldPx = old.offsetM <= CARRY_M ? pxApart(v, p, trackPointInto(to, old.distance, v, q)) : 0
            if (oldPx > 1) groundJumps++
            const r = replay(from, d, to, v)
            expect(r.carried, `${a.id} -> ${b.id} @${d}`).toBe(true)
            carried++
            worst = { jumpPx: Math.max(worst.jumpPx, r.jumpPx), stepPx: Math.max(worst.stepPx, r.stepPx), endPx: Math.max(worst.endPx, r.endPx) }
          }
        }
      }
    }
    expect(carried).toBeGreaterThan(1000)
    // The cases this guards: the ground projection jumped more than 1 px in some of them.
    expect(groundJumps).toBeGreaterThan(0)
    expect(worst.jumpPx).toBeLessThan(1)
    expect(worst.stepPx).toBeLessThan(1)
    expect(worst.endPx).toBeLessThan(1e-6)
  }, 60_000)
})
