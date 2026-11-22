/**
 * Variant cover on the committed public/data: how much of the variants the map leaves out, and that every segment it
 * leaves out draws where its primary already does, under the band shader's own math (trackPointInto is its CPU twin)
 * at city, 1 km, station and closest zoom, top-down and tilted, with the bands easing in. The daily refresh changes
 * the shapes, so the bounds are shares and pixel tolerances, not counts.
 */
import { PerspectiveCamera } from 'three'
import { describe, expect, it } from 'vitest'
import routesRaw from '../../public/data/routes.json?raw'
import depthsRaw from '../../public/data/station-depths.json?raw'
import shapesRaw from '../../public/data/shapes.json?raw'
import stationsRaw from '../../public/data/stations.json?raw'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { PackedDepthsFile } from '../data/stationSchema'
import { createBandView, writeBandView } from './bandOffset'
import { buildSegmentGrid, cellIndex, segmentDistance } from './corridorHash'
import { createTrackPoint, trackPointInto, type DrawnTrack } from './live/trackPoint'
import { buildLineBuffers } from './lineBuffers'
import { buildNetwork, type ShapePath } from './network'
import { bandNetwork } from './networkBands'
import { depthFactor, ISO_POLAR, tiltT } from './tilt'
import { TRACK_OFFSET_M } from './trackOffset'

const network = buildNetwork(
  JSON.parse(stationsRaw) as StationsFile,
  JSON.parse(routesRaw) as RoutesFile,
  JSON.parse(shapesRaw) as ShapesFile,
  TRACK_OFFSET_M,
  JSON.parse(depthsRaw) as PackedDepthsFile,
  2,
)
const { shapes, shapeById } = bandNetwork(network)
const variants = shapes.filter((s) => !s.primary)
const segmentCount = (paths: readonly ShapePath[]) => paths.reduce((n, s) => n + s.points.length - 1, 0)
const covered = (s: ShapePath) => s.cover?.segments.reduce((n, v) => n + v, 0) ?? 0

const primaries = shapes.filter((s) => s.primary)
const primaryIndex = new Map(primaries.map((s, i) => [s.id, i]))
/** Every primary's segments, so a skipped variant point finds the distance along its primary that it lies at. */
const grid = buildSegmentGrid(
  primaries.map((s) => s.points),
  primaries.map(() => 0),
  1,
  100,
)

/** Distance along primary `owner` nearest (x, z), and how far off it is. */
function alongPrimary(owner: number, x: number, z: number): { d: number; off: number } {
  const c = cellIndex(grid, x, z)
  let best = { d: 0, off: Infinity }
  if (c < 0) return best
  for (let j = grid.start[c]!; j < grid.start[c + 1]!; j++) {
    const seg = grid.items[j]!
    if (grid.owner[seg] !== owner) continue
    const off = segmentDistance(grid, seg, x, z)
    if (off >= best.off) continue
    const t = Math.min(Math.max((x - grid.ax[seg]!) * grid.ux[seg]! + (z - grid.az[seg]!) * grid.uz[seg]!, 0), grid.len[seg]!)
    best = { d: grid.startD[seg]! + t, off }
  }
  return best
}

interface ViewCase {
  name: string
  distance: number
  azimuth: number
  ease: number
}

/** Top-down at the city overview, partly and fully tilted closer, and with the bands half eased in. */
const VIEWS: ViewCase[] = [
  { name: 'city', distance: 30_000, azimuth: 0, ease: 1 },
  { name: '1 km', distance: 1_000, azimuth: 0.7, ease: 1 },
  { name: '1 km, bands easing in', distance: 1_000, azimuth: 0, ease: 0.5 },
  { name: 'station', distance: 400, azimuth: -2.1, ease: 1 },
  { name: 'interior', distance: 180, azimuth: 2.6, ease: 1 },
  { name: 'closest', distance: 40, azimuth: 1.2, ease: 1 },
]

const camera = new PerspectiveCamera(35, 390 / 844, 10, 1e7)
const view = createBandView()
const drawn = (s: ShapePath): DrawnTrack => ({ line: s, profile: s.profile, bandInputs: s.bandInputs })
const onVariant = createTrackPoint()
const onPrimary = createTrackPoint()

/** Points the camera at (x, z) from `c` as the camera rig would (polar angle by distance, depth factor by distance). */
function lookAt(c: ViewCase, x: number, z: number): void {
  const polar = ISO_POLAR * tiltT(c.distance)
  const h = c.distance * Math.sin(polar)
  camera.up.set(0, 1, 0)
  camera.position.set(x + h * Math.sin(c.azimuth), c.distance * Math.cos(polar), z + h * Math.cos(c.azimuth))
  if (polar < 1e-6) camera.up.set(0, 0, -1)
  camera.lookAt(x, 0, z)
  camera.updateMatrixWorld()
  writeBandView(view, camera.matrixWorldInverse.elements, camera.projectionMatrix.elements[5]!, 844, c.distance, 2.5, TRACK_OFFSET_M, c.ease, depthFactor(c.distance))
}

describe('real public/data: variant cover', () => {
  it('leaves out most of the variant segments', () => {
    const skipped = variants.reduce((n, s) => n + covered(s), 0)
    const all = segmentCount(shapes)
    // 52% of the variants' 51.5k segments on the fall 2026 data: 64.7k segments drawn as 38.0k.
    expect(skipped / segmentCount(variants)).toBeGreaterThan(0.4)
    expect(buildLineBuffers(shapes, new Map(), () => [0, 0, 0], true).positions.length / 6).toBe(all - skipped)
  })

  it.each(VIEWS)('draws every left-out segment within 0.05 px of its primary ($name)', (c) => {
    let worstPx = 0
    let worst = ''
    let checked = 0
    for (const s of variants) {
      if (!s.cover) continue
      const owner = primaryIndex.get(s.cover.primaryId)!
      const primary = drawn(shapeById.get(s.cover.primaryId)!)
      const variant = drawn(s)
      // Look at each covered run once from its start, so the view scale is local to it.
      let looking = false
      for (let i = 0; i < s.cover.segments.length; i++) {
        if (!s.cover.segments[i]) {
          looking = false
          continue
        }
        if (!looking) lookAt(c, s.points[i]!.x, s.points[i]!.z)
        looking = true
        const metersPerPx = view.k * c.distance
        for (const d of [s.cumulative[i]!, (s.cumulative[i]! + s.cumulative[i + 1]!) / 2, s.cumulative[i + 1]!]) {
          trackPointInto(variant, d, view, onVariant)
          const p = s.points[i]!
          const q = s.points[i + 1]!
          const t = (d - s.cumulative[i]!) / Math.max(s.cumulative[i + 1]! - s.cumulative[i]!, 1e-9)
          const hit = alongPrimary(owner, p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t)
          expect(hit.off).toBeLessThan(1e-3)
          trackPointInto(primary, hit.d, view, onPrimary)
          const px = Math.hypot(onVariant.x - onPrimary.x, onVariant.y - onPrimary.y, onVariant.z - onPrimary.z) / metersPerPx
          checked++
          if (px > worstPx) {
            worstPx = px
            worst = `${s.id} segment ${i}`
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0)
    expect(worstPx, worst).toBeLessThan(0.05)
  })

  it('draws every segment inside a platform span of its primary, where the primary fades', () => {
    let inSpans = 0
    let checked = 0
    for (const s of variants) {
      if (!s.cover) continue
      const owner = primaryIndex.get(s.cover.primaryId)!
      const spans = [...network.platformSpans.values()].flatMap((m) => m.get(s.cover!.primaryId) ?? [])
      s.cover.segments.forEach((v, i) => {
        if (!v) return
        checked++
        const [a, b] = [s.points[i]!, s.points[i + 1]!].map((p) => alongPrimary(owner, p.x, p.z).d)
        // A segment may end where a span starts (a fade break): the weight is 0 there.
        if (spans.some((sp) => b! > sp.d0 + 1e-6 && a! < sp.d1 - 1e-6)) inSpans++
      })
    }
    expect(checked).toBeGreaterThan(0)
    expect(inSpans).toBe(0)
  })
})
