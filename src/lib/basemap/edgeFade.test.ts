import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../data/schema'
import { groundX, groundZ, toGround } from '../projection'
import {
  EDGE_FADE_MAX_M,
  EDGE_FADE_MIN_M,
  edgeAlpha,
  edgeFadeFor,
  NETWORK_FADE_M,
  NETWORK_PAD_M,
  networkAlpha,
  sceneBox,
} from './edgeFade'
import { networkHull } from './networkHull'

const BBOX = [-74.2591, 40.4774, -73.7004, 40.9176] as const

describe('sceneBox', () => {
  it('puts west and north at the low x and z (x east, z south)', () => {
    const box = sceneBox(BBOX)
    expect(box.minX).toBe(groundX(BBOX[0]))
    expect(box.maxX).toBe(groundX(BBOX[2]))
    expect(box.minZ).toBe(groundZ(BBOX[3]))
    expect(box.maxZ).toBe(groundZ(BBOX[1]))
  })
})

describe('edgeFadeFor', () => {
  it('is 4% of the camera distance, held to 100 m..3 km', () => {
    expect(edgeFadeFor(400)).toBe(EDGE_FADE_MIN_M)
    expect(edgeFadeFor(10_000)).toBeCloseTo(400, 9)
    expect(edgeFadeFor(80_000)).toBe(EDGE_FADE_MAX_M)
  })
})

describe('edgeAlpha', () => {
  const box = { minX: 0, maxX: 40_000, minZ: 0, maxZ: 50_000 }

  it('is 1 well inside, 0 at and outside every edge', () => {
    expect(edgeAlpha(20_000, 25_000, box, 3000)).toBe(1)
    expect(edgeAlpha(3000, 25_000, box, 3000)).toBe(1)
    for (const [x, z] of [[0, 25_000], [40_000, 25_000], [20_000, 0], [20_000, 50_000], [-10, 25_000], [20_000, 60_000]]) {
      expect(edgeAlpha(x!, z!, box, 3000), `${x},${z}`).toBe(0)
    }
  })

  it('eases in by the nearest edge, halfway at half the fade', () => {
    expect(edgeAlpha(1500, 25_000, box, 3000)).toBeCloseTo(0.5, 12)
    expect(edgeAlpha(20_000, 50_000 - 50, box, 100)).toBeCloseTo(0.5, 12)
    expect(edgeAlpha(1500, 100, box, 3000)).toBe(edgeAlpha(100, 25_000, box, 3000))
  })
})

describe('networkAlpha', () => {
  const edges = networkHull([{ x: -10_000, z: -20_000 }, { x: 10_000, z: -20_000 }, { x: 10_000, z: 20_000 }, { x: -10_000, z: 20_000 }])

  it('is 1 inside the outline and within NETWORK_PAD_M of it, then fades to 0 over NETWORK_FADE_M', () => {
    expect(networkAlpha(0, 0, edges)).toBe(1)
    expect(networkAlpha(10_000 + NETWORK_PAD_M, 0, edges)).toBe(1)
    expect(networkAlpha(10_000 + NETWORK_PAD_M + NETWORK_FADE_M / 2, 0, edges)).toBeCloseTo(0.5, 12)
    expect(networkAlpha(0, -20_000 - NETWORK_PAD_M - NETWORK_FADE_M, edges)).toBe(0)
  })
})

describe('the basemap at station zoom', () => {
  it('draws at 0.95 or more at every station point at 400 m', () => {
    const stations = (JSON.parse(readFileSync('public/data/stations.json', 'utf8')) as StationsFile).stations
    const points = stations.map((s) => toGround({ lat: s.lat, lon: s.lon }))
    const net = networkHull(points)
    const spec = JSON.parse(readFileSync('data/basemap/basemap.json', 'utf8')) as { spec: { bbox: [number, number, number, number] } }
    const edge = sceneBox(spec.spec.bbox)
    const fade = edgeFadeFor(400)
    for (const [i, p] of points.entries()) {
      const a = networkAlpha(p.x, p.z, net) * edgeAlpha(p.x, p.z, edge, fade)
      expect(a, stations[i]!.id).toBeGreaterThanOrEqual(0.95)
    }
  })
})
