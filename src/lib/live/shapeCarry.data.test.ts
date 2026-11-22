/**
 * Shape changes replayed on the committed public/data with its real bands: every pair of one route and direction's
 * shapes, sampled around three banded junctions, as a train on one moves to the other at 180, 400 and 600 m (the
 * app's tilt, a phone's 390 x 844 canvas). The ground-line projection jumped a band pitch or more on screen there;
 * the drawn one (shapeCarry.ts) must not jump, nor step more than 1 px a frame while the gap eases out, or else
 * cross-fades (a gap over CARRY_MAX_PX on screen).
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

const STEP_M = 200
const RADIUS_M = 500

/** DeKalb Av, W 4 St and 34 St-Herald Sq: where several routes split and merge on banded track. */
const JUNCTIONS = ['R30', 'D20', 'R17'].map((id) => network.stationById.get(id)!.pos)

/** Every carry-over at `distance` from the junctions: how many slid, cross-faded, and the worst jump and frame step of those that slid. */
function replayAll(distance: number) {
  const groups = new Map<string, ShapePath[]>()
  for (const s of shapes) {
    const k = `${s.routeId}/${s.direction}`
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const near = (p: { x: number; z: number }) => JUNCTIONS.some((j) => Math.hypot(p.x - j.x, p.z - j.z) < RADIUS_M)
  const p = createTrackPoint()
  const q = createTrackPoint()
  const hit = { distance: 0, offsetM: 0 }
  const out = { slid: 0, faded: 0, groundJumps: 0, jumpPx: 0, stepPx: 0, endPx: 0 }
  for (const group of groups.values()) {
    for (const a of group) {
      for (const b of group) {
        if (a === b) continue
        const from = geometryOf(a)
        const to = geometryOf(b)
        for (let d = 0; d < a.length; d += STEP_M) {
          const ground = pointAtDistance(a, d).point
          if (!near(ground)) continue
          const v = viewAt(ground, distance)
          trackPointInto(from, d, v, p)
          if (nearestOnTrack(to, p, v, hit).offsetM > CARRY_M) continue
          // The old way: the ground point projected onto the new ground line, drawn there.
          const old = projectForward(b, ground, { segment: 0, t: 0 })
          if (old.offsetM <= CARRY_M && pxApart(v, p, trackPointInto(to, old.distance, v, q)) > 1) out.groundJumps++
          const r = replay(from, d, to, v)
          if (!r.carried) {
            out.faded++
            continue
          }
          out.slid++
          out.jumpPx = Math.max(out.jumpPx, r.jumpPx)
          out.stepPx = Math.max(out.stepPx, r.stepPx)
          out.endPx = Math.max(out.endPx, r.endPx)
        }
      }
    }
  }
  return out
}

describe('real public/data: shape changes at banded junctions', () => {
  it.each([180, 400, 600])('slides with no jump and no frame step over 1 px, or cross-fades, at %i m', (distance) => {
    const r = replayAll(distance)
    expect(r.slid, JSON.stringify(r)).toBeGreaterThan(1000)
    // The cases this guards: the ground projection jumped more than 1 px in some of them.
    expect(r.groundJumps).toBeGreaterThan(0)
    expect(r.jumpPx, JSON.stringify(r)).toBeLessThan(1)
    expect(r.stepPx, JSON.stringify(r)).toBeLessThan(1)
    expect(r.endPx).toBeLessThan(1e-6)
    if (process.env.CARRY_STATS) console.log(`shape carry at ${distance} m: ${JSON.stringify(r)}`)
  }, 60_000)
})
