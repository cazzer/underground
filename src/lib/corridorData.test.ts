/**
 * Band slots on the committed public/data, at the Manhattan trunks the bands are for. The daily refresh
 * regenerates shapes, so the checks read slots at stations rather than at fixed distances.
 */
import { describe, expect, it } from 'vitest'
import routesRaw from '../../public/data/routes.json?raw'
import depthsRaw from '../../public/data/station-depths.json?raw'
import shapesRaw from '../../public/data/shapes.json?raw'
import stationsRaw from '../../public/data/stations.json?raw'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { StationDepthsFile } from '../data/stationSchema'
import { bandKey } from './corridors'
import { buildNetwork, type ShapePath } from './network'
import { bandNetwork } from './networkBands'
import { pointAtDistance, projectForward } from './realtime/polyline'
import { TRACK_OFFSET_M } from './trackOffset'
import { profileAt } from './trackProfile'

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
const keyOf = new Map(routes.routes.map((r) => [r.id, bandKey(r.shortName)]))

/**
 * Slot of each of `routeIds` passing within 25 m of the station, by "route direction": its primary shape's, else
 * its first passing one's (the fall 2026 M primary skips 6 Av).
 */
function slotsAt(stationId: string, routeIds: readonly string[]): Map<string, number> {
  const station = network.stationById.get(stationId)
  if (!station) throw new Error(`No station ${stationId}`)
  const out = new Map<string, number>()
  for (const s of [...bandedShapes].sort((a, b) => Number(b.primary) - Number(a.primary))) {
    const key = `${s.routeId}${s.direction}`
    if (!routeIds.includes(s.routeId) || out.has(key)) continue
    const hit = projectForward(s, station.pos, { segment: 0, t: 0 })
    if (hit.offsetM > 25) continue
    out.set(key, profileAt(s.bands.slot, hit.distance))
  }
  return out
}

/** Each route of `routeIds` on its own slot of a full bundle (-(n-1)/2 .. (n-1)/2), mirrored southbound. */
function expectBundle(stationId: string, routeIds: readonly string[]): Map<string, number> {
  const slots = slotsAt(stationId, routeIds)
  const north = routeIds.map((r) => slots.get(`${r}N`))
  const half = (routeIds.length - 1) / 2
  expect([...north].sort((a, b) => a! - b!)).toEqual(routeIds.map((_, i) => i - half))
  // One order across the street: a route sits on the same side in both directions.
  expect(routeIds.map((r) => slots.get(`${r}S`))).toEqual(north.map((v) => (v === 0 ? 0 : -v!)))
  return slots
}

describe('real public/data: shared corridors', () => {
  it('bands the 8 Av A, C, E and the 7 Av 1, 2, 3 at 34 St-Penn Station, mirrored southbound', () => {
    expectBundle('A28', ['A', 'C', 'E'])
    expectBundle('128', ['1', '2', '3'])
  })

  it('bands 6 Av and Broadway apart at Herald Sq, four routes each', () => {
    expectBundle('D17', ['B', 'D', 'F', 'M'])
    expectBundle('R17', ['N', 'Q', 'R', 'W'])
  })

  it('bands A, C, B, D up Central Park West in track order (B/D west of A/C), and the 4, 5, 6 at 59 St', () => {
    const cpw = expectBundle('A24', ['A', 'C', 'B', 'D'])
    // The B/D line runs about 1.5 m west of the A/C line here: their bands go west too, adding to the gap.
    expect(Math.max(cpw.get('BN')!, cpw.get('DN')!)).toBeLessThan(Math.min(cpw.get('AN')!, cpw.get('CN')!))
    expectBundle('629', ['4', '5', '6'])
  })

  it('gives the G its own band beside the F through Bergen St', () => {
    expectBundle('F20', ['F', 'G'])
  })

  /** Calls `visit(a, d, b, dB)` where primary banded shapes of different band keys run within `withinM`, heading the same way. */
  function coRunning(stepM: number, withinM: number, visit: (a: ShapePath, d: number, b: ShapePath, dB: number) => void) {
    const shapes = bandedShapes.filter((s) => s.primary && s.bands.slot.d.length > 0)
    const box = (s: ShapePath) => {
      const xs = s.points.map((p) => p.x)
      const zs = s.points.map((p) => p.z)
      return [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)] as const
    }
    const boxes = new Map(shapes.map((s) => [s, box(s)]))
    for (const a of shapes) {
      const ba = boxes.get(a)!
      for (const b of shapes) {
        const bb = boxes.get(b)!
        if (a === b || keyOf.get(b.routeId) === keyOf.get(a.routeId)) continue
        if (ba[0] > bb[1] + withinM || bb[0] > ba[1] + withinM || ba[2] > bb[3] + withinM || bb[2] > ba[3] + withinM) continue
        for (let d = 0; d < a.length; d += stepM) {
          const { point, heading } = pointAtDistance(a, d)
          const hit = projectForward(b, point, { segment: 0, t: 0 })
          if (hit.offsetM > withinM) continue
          if (Math.cos(pointAtDistance(b, hit.distance).heading - heading) < Math.cos((10 * Math.PI) / 180)) continue
          visit(a, d, b, hit.distance)
        }
      }
    }
  }

  it('never puts two routes heading the same way on the same slot where they run within 6 m', () => {
    const flat = (s: ShapePath, d: number) => {
      const v = profileAt(s.bands.slot, d)
      return profileAt(s.bands.slot, d - 200) === v && profileAt(s.bands.slot, d + 200) === v
    }
    let compared = 0
    const clashes: string[] = []
    coRunning(250, 6, (a, d, b, dB) => {
      if (d < 200 || d > a.length - 200 || !flat(a, d) || !flat(b, dB)) return
      compared++
      if (profileAt(a.bands.slot, d) === profileAt(b.bands.slot, dB)) clashes.push(`${a.id}@${d}/${b.id}`)
    })
    expect(compared).toBeGreaterThan(1000)
    expect(clashes).toEqual([])
  })

  it('never swaps two co-running routes from one side to the other', () => {
    const swaps = new Set<string>()
    const last = new Map<string, { side: number; d: number }>()
    coRunning(50, 8, (a, d, b, dB) => {
      const diff = profileAt(a.bands.slot, d) - profileAt(b.bands.slot, dB)
      if (Math.abs(diff) < 0.4) return
      const key = `${a.id}/${b.id}`
      const prev = last.get(key)
      const side = Math.sign(diff)
      if (prev && prev.side !== side && d - prev.d < 1500) swaps.add(`${key} near ${Math.round(d)} m`)
      last.set(key, { side, d })
    })
    expect([...swaps]).toEqual([])
  })
})
