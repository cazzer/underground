/** Checks that offset shapes land on the real tracks, using the committed public/data. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeShapePoints } from '../../src/data/codec.ts'
import type { ShapesFile } from '../../src/data/schema.ts'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { toGround, type Ground } from '../../src/lib/projection.ts'
import { MITER_LIMIT, offsetPolyline, TRACK_OFFSETS } from '../../src/lib/trackOffset.ts'

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const shapes = (readJson('../../public/data/shapes.json') as ShapesFile).shapes
const l08 = readJson('../../public/data/stations/L08.json') as StationInterior
const D = TRACK_OFFSETS.a

function distanceToPolyline(p: Ground, line: readonly Ground[]): number {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t))
  }
  return best
}

describe('Bedford Av (L08) track alignment', () => {
  const anchor = toGround(l08.anchor)
  const lShapes = shapes
    .filter((s) => s.routeId === 'L')
    .map((s) => ({ id: s.id, direction: s.direction, points: offsetPolyline(decodeShapePoints(s).map((p) => toGround(p)), D) }))
    .filter((s) => distanceToPolyline(anchor, s.points) < 50)
  const tracks = l08.platforms.flatMap((p) => p.tracks)

  it('has L shapes in both directions through the station', () => {
    expect(new Set(lShapes.map((s) => s.direction))).toEqual(new Set(['N', 'S']))
    expect(tracks.map((t) => t.stopId).sort()).toEqual(['L08N', 'L08S'])
  })

  it.each(tracks)('puts each direction on its own platform track ($stopId)', (track) => {
    const first = track.path[0]!
    const last = track.path.at(-1)!
    const samples = [first, [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2], last].map(
      ([x, z]): Ground => ({ x: anchor.x + x!, z: anchor.z + z! }),
    )
    const direction = track.stopId.at(-1)
    for (const shape of lShapes) {
      samples.forEach((p, i) => {
        const d = distanceToPolyline(p, shape.points)
        const label = `${shape.id} to ${track.stopId} sample ${i}`
        // Measured 1.25 m at the middle: the projected L runs that far NE of the anchor axis. Its
        // bearing differs by 0.27 degrees, so the 170 m track ends read 0.85 m and 1.65 m.
        if (shape.direction === direction) expect(d, label).toBeLessThan(i === 1 ? 1.5 : 1.75)
        else expect(d, label).toBeGreaterThan(5)
      })
    }
  })
})

describe('offsetting every shape', () => {
  it('moves each vertex between d and the miter cap, with no NaN', () => {
    for (const s of shapes) {
      const center = decodeShapePoints(s).map((p) => toGround(p))
      const out = offsetPolyline(center, D)
      expect(out.length, s.id).toBe(center.length)
      for (let i = 0; i < out.length; i++) {
        const moved = Math.hypot(out[i]!.x - center[i]!.x, out[i]!.z - center[i]!.z)
        expect(Number.isFinite(moved), s.id).toBe(true)
        expect(moved, `${s.id} vertex ${i}`).toBeGreaterThanOrEqual(D - 1e-6)
        expect(moved, `${s.id} vertex ${i}`).toBeLessThanOrEqual(MITER_LIMIT * D + 1e-6)
      }
    }
  })
})
