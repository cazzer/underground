/**
 * Drawn positions on the committed public/data: where routes of different colours share Manhattan track, how much
 * of it draws within 1 px of another colour, top-down on a phone's 390 x 844 canvas, with the bands and the split
 * tracks exactly as the lines and trains draw them (trackPointInto). Bands that cancel the tracks' real spacing
 * show up here (route_sort_order bands hid 23% of it at 600 m and 13% at 1 km; ordering by track, 2.6% and 1.9%).
 */
import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import routesRaw from '../../public/data/routes.json?raw'
import depthsRaw from '../../public/data/station-depths.json?raw'
import shapesRaw from '../../public/data/shapes.json?raw'
import stationsRaw from '../../public/data/stations.json?raw'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { StationDepthsFile } from '../data/stationSchema'
import { createBandView, writeBandView } from './bandOffset'
import { createTrackPoint, trackPointInto, type DrawnTrack } from './live/trackPoint'
import { buildNetwork, type ShapePath } from './network'
import { bandNetwork } from './networkBands'
import { toGround } from './projection'
import { pointAtDistance, projectForward } from './realtime/polyline'
import { TRACK_OFFSET_M } from './trackOffset'

const routes = JSON.parse(routesRaw) as RoutesFile
const network = buildNetwork(
  JSON.parse(stationsRaw) as StationsFile,
  routes,
  JSON.parse(shapesRaw) as ShapesFile,
  TRACK_OFFSET_M,
  JSON.parse(depthsRaw) as StationDepthsFile,
  2,
)
const { shapes: bandedShapes } = bandNetwork(network)
const colourOf = new Map(routes.routes.map((r) => [r.id, r.color]))
const PITCH_PX = 2.5
const HEIGHT_PX = 844
const STEP_M = 20

const camera = new PerspectiveCamera(35, 390 / HEIGHT_PX, 10, 1e7)
camera.up.set(0, 0, -1)
const view = createBandView()
const a = createTrackPoint()
const drawn = (s: ShapePath): DrawnTrack => ({ line: s, profile: s.profile, bandInputs: s.bandInputs })
const b = createTrackPoint()

interface Overlap {
  /** Meters of track beside another colour, and of those, meters drawn within 1 px of one. */
  shared: number
  hidden: number
  pairs: Map<string, number>
}

/**
 * Walks every primary shape of `routeIds` (all when null) within `box` every STEP_M; another colour's primary
 * within 12 m heading within 15 degrees shares the track there. Each sample looks straight down from `distance`.
 */
function overlap(distance: number, box: { minX: number; maxX: number; minZ: number; maxZ: number }, routeIds: readonly string[] | null): Overlap {
  const inBox = (p: { x: number; z: number }) => p.x > box.minX && p.x < box.maxX && p.z > box.minZ && p.z < box.maxZ
  const shapes = bandedShapes.filter((s) => s.primary && (!routeIds || routeIds.includes(s.routeId)))
  const out: Overlap = { shared: 0, hidden: 0, pairs: new Map() }
  const near = new Map(
    shapes.map((s) => {
      const xs = s.points.map((p) => p.x)
      const zs = s.points.map((p) => p.z)
      const [x0, x1, z0, z1] = [Math.min(...xs) - 12, Math.max(...xs) + 12, Math.min(...zs) - 12, Math.max(...zs) + 12]
      return [s, (p: { x: number; z: number }) => p.x > x0 && p.x < x1 && p.z > z0 && p.z < z1] as const
    }),
  )
  for (const s of shapes) {
    const others = shapes.filter((o) => colourOf.get(o.routeId) !== colourOf.get(s.routeId))
    for (let d = 0; d < s.length; d += STEP_M) {
      const { point, heading } = pointAtDistance(s, d)
      if (!inBox(point)) continue
      const hx = Math.sin(heading)
      const hz = -Math.cos(heading)
      const beside: [ShapePath, number][] = []
      for (const o of others) {
        if (!near.get(o)!(point)) continue
        const hit = projectForward(o, point, { segment: 0, t: 0 })
        if (hit.offsetM > 12) continue
        if (Math.cos(pointAtDistance(o, hit.distance).heading - heading) < Math.cos((15 * Math.PI) / 180)) continue
        beside.push([o, hit.distance])
      }
      if (beside.length === 0) continue
      out.shared += STEP_M
      camera.position.set(point.x, distance, point.z + 1e-3)
      camera.lookAt(point.x, 0, point.z)
      camera.updateMatrixWorld()
      writeBandView(view, camera.matrixWorldInverse.elements, camera.projectionMatrix.elements[5]!, HEIGHT_PX, distance, PITCH_PX, TRACK_OFFSET_M)
      const metersPerPx = (2 / (camera.projectionMatrix.elements[5]! * HEIGHT_PX)) * distance
      trackPointInto(drawn(s), d, view, a)
      const hit = beside.find(([o, dO]) => {
        trackPointInto(drawn(o), dO, view, b)
        return Math.abs((b.x - a.x) * hz - (b.z - a.z) * hx) / metersPerPx < 1
      })
      if (!hit) continue
      out.hidden += STEP_M
      const key = [s.routeId, hit[0].routeId].sort().join('/')
      out.pairs.set(key, (out.pairs.get(key) ?? 0) + STEP_M)
    }
  }
  return out
}

const sw = toGround({ lat: 40.7, lon: -74.02 })
const ne = toGround({ lat: 40.8, lon: -73.93 })
const MANHATTAN = { minX: sw.x, maxX: ne.x, minZ: ne.z, maxZ: sw.z }

describe('real public/data: drawn bands', () => {
  it.each([600, 1000])('draws under a twentieth of shared Manhattan track within 1 px of another colour at %i m', (distance) => {
    const { shared, hidden, pairs } = overlap(distance, MANHATTAN, null)
    expect(shared).toBeGreaterThan(50_000)
    expect(hidden / shared, [...pairs].join(', ')).toBeLessThan(0.05)
  })

  it.each([600, 1000])('never draws the A, C, B and D on one another up Central Park West at %i m', (distance) => {
    const south = network.stationById.get('A24')!.pos
    const north = network.stationById.get('A16')!.pos
    // 59 St (200 m in from the junction) to 116 St. North of there the GTFS B/D line crosses to the east of the
    // A/C line (1 m by 135 St), so a band order kept all along the run gives back some of the gap there instead.
    const cpw = { minX: -Infinity, maxX: Infinity, minZ: north.z, maxZ: south.z - 200 }
    const { shared, hidden, pairs } = overlap(distance, cpw, ['A', 'B', 'C', 'D'])
    expect(shared).toBeGreaterThan(20_000)
    expect(hidden, [...pairs].join(', ')).toBe(0)
  })
})
