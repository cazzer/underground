import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LocalPoint, StationInterior } from '../data/stationSchema'
import { insidePolygon } from './footprintPick'
import { fixture } from './interiorFixture'
import { FOCUS_FRAME_PAD_M, FOOTPRINT_PAD_M, footprintLoopBuffers, interiorFootprint } from './interiorFootprint'

const ORIGIN = { x: 500, z: -300 }

function pointsOf(interior: StationInterior): LocalPoint[] {
  return [
    ...interior.platforms.flatMap((p) => p.outline),
    ...interior.slabs.flatMap((s) => s.outline),
    ...interior.entrances.map((e): LocalPoint => [e.x, e.z]),
  ]
}

/** How far `p` lies inside `hull`: its distance to the nearest edge, negative outside. */
function depthInside(p: LocalPoint, hull: readonly LocalPoint[]): number {
  let d = Infinity
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!
    const b = hull[(i + 1) % hull.length]!
    const dx = b[0] - a[0]
    const dz = b[1] - a[1]
    const t = Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz), 0), 1)
    d = Math.min(d, Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t))
  }
  const inside = insidePolygon(p[0], p[1], hull.map((q) => q[0]), hull.map((q) => q[1]), hull.length)
  return inside ? d : -d
}

describe('interiorFootprint', () => {
  it('holds every outline point and entrance at least the pad inside', () => {
    const interior = fixture()
    const fp = interiorFootprint(interior, 2, ORIGIN)
    expect(fp.originX).toBe(ORIGIN.x)
    expect(fp.originZ).toBe(ORIGIN.z)
    for (const p of pointsOf(interior)) expect(depthInside(p, fp.hull), `${p}`).toBeGreaterThanOrEqual(FOOTPRINT_PAD_M - 1e-9)
  })

  it('spans the street and every level, times yScale', () => {
    expect(interiorFootprint(fixture(), 2, ORIGIN)).toMatchObject({ yLow: -16, yHigh: 0 })
    const elevated = fixture()
    elevated.levels = [
      { id: 'plat', name: 'Platform', kind: 'platform', y: 9 },
      { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: 4 },
      { id: 'street', name: 'Street', kind: 'street', y: 0 },
    ]
    expect(interiorFootprint(elevated, 2, ORIGIN)).toMatchObject({ yLow: 0, yHigh: 18 })
  })

  it('throws, naming the station, with fewer than three points to enclose', () => {
    const bare = fixture()
    bare.platforms = []
    bare.slabs = []
    expect(() => interiorFootprint(bare, 2, ORIGIN)).toThrow(/X01/)
  })

  it('holds every point at least the focus frame pad inside the frame hull, past the pick footprint', () => {
    const interior = fixture()
    const frame = interiorFootprint(interior, 2, ORIGIN, FOCUS_FRAME_PAD_M)
    expect(FOCUS_FRAME_PAD_M).toBeGreaterThan(FOOTPRINT_PAD_M)
    for (const p of pointsOf(interior)) expect(depthInside(p, frame.hull), `${p}`).toBeGreaterThanOrEqual(FOCUS_FRAME_PAD_M - 1e-9)
  })

  it('is built for every shipped interior, the pick footprint and the frame hull holding all its points', () => {
    const dir = new URL('../../public/data/stations/', import.meta.url)
    const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'index.json' && f !== 'equipment.json' && f !== 'amenities.json')
    expect(files.length).toBeGreaterThan(200)
    for (const f of files) {
      const interior = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as StationInterior
      for (const pad of [FOOTPRINT_PAD_M, FOCUS_FRAME_PAD_M]) {
        const fp = interiorFootprint(interior, 2, ORIGIN, pad)
        for (const p of pointsOf(interior)) expect(depthInside(p, fp.hull), `${f} ${pad} m ${p}`).toBeGreaterThan(pad - 1e-6)
      }
    }
  })
})

describe('footprintLoopBuffers', () => {
  it('closes the hull at street level in one colour, solid', () => {
    const hull: LocalPoint[] = [
      [0, 0],
      [4, 0],
      [4, 3],
    ]
    const b = footprintLoopBuffers(hull, [0.1, 0.2, 0.3])
    expect([...b.positions]).toEqual([0, 0, 0, 4, 0, 0, 4, 0, 0, 4, 0, 3, 4, 0, 3, 0, 0, 0])
    expect(Array.from(b.colors, (c) => +c.toFixed(5))).toEqual(Array(6).fill([0.1, 0.2, 0.3]).flat())
    expect([...b.distances]).toEqual([0, 0, 0, 0, 0, 0])
  })
})
