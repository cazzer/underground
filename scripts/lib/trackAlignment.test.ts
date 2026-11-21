/**
 * Checks offset shapes against the committed public/data, which the daily refresh regenerates:
 * assertions stick to what the offset controls, with headroom for small shape changes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeShapePoints } from '../../src/data/codec.ts'
import type { ShapesFile } from '../../src/data/schema.ts'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { toGround, type Ground } from '../../src/lib/projection.ts'
import { dropSpurs, trackLine } from '../../src/lib/trackLine.ts'
import { MITER_LIMIT, TRACK_OFFSETS } from '../../src/lib/trackOffset.ts'

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const shapes = (readJson('../../public/data/shapes.json') as ShapesFile).shapes
const l08 = readJson('../../public/data/stations/L08.json') as StationInterior
const D = TRACK_OFFSETS.a

function nearestOnPolyline(p: Ground, line: readonly Ground[]): Ground {
  let best = { x: line[0]!.x, z: line[0]!.z }
  let bestD = Infinity
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!
    const b = line[i]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
    const q = { x: a.x + dx * t, z: a.z + dz * t }
    const d = Math.hypot(p.x - q.x, p.z - q.z)
    if (d < bestD) [best, bestD] = [q, d]
  }
  return best
}
const dist = (a: Ground, b: Ground) => Math.hypot(a.x - b.x, a.z - b.z)
const lerp = (a: Ground, b: Ground, t: number): Ground => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })

// Measured with ?tracks=a: the offset L sits 1.25 m from each platform track at its middle, and
// 0.85 m to 1.65 m along the 170 m track, because the projected L runs 1.25 m NE of the anchor
// axis with a bearing 0.27 degrees off the platform's.
describe('Bedford Av (L08) track alignment', () => {
  const anchor = toGround(l08.anchor)
  const lShapes = shapes
    .filter((s) => s.routeId === 'L')
    .map((s) => ({ id: s.id, direction: s.direction, points: trackLine(s, D) }))
    .filter((s) => dist(anchor, nearestOnPolyline(anchor, s.points)) < 50)
  const north = lShapes.filter((s) => s.direction === 'N')
  const south = lShapes.filter((s) => s.direction === 'S')
  const track = (stopId: string) => {
    const t = l08.platforms.flatMap((p) => p.tracks).find((t) => t.stopId === stopId)
    if (!t) throw new Error(`L08 has no ${stopId} track`)
    const [first, last] = [t.path[0]!, t.path.at(-1)!]
    return { a: { x: anchor.x + first[0], z: anchor.z + first[1] }, b: { x: anchor.x + last[0], z: anchor.z + last[1] } }
  }
  // Both authored tracks run the same way (west to east), so equal t is the same cross-section.
  const n = track('L08N')
  const s = track('L08S')
  const axisA = lerp(n.a, s.a, 0.5)
  const axisB = lerp(n.b, s.b, 0.5)
  const fromAxis = (p: Ground) =>
    Math.abs((axisB.x - axisA.x) * (p.z - axisA.z) - (axisB.z - axisA.z) * (p.x - axisA.x)) / dist(axisA, axisB)

  it('has L shapes in both directions through the station', () => {
    expect(north.length).toBeGreaterThan(0)
    expect(south.length).toBeGreaterThan(0)
  })

  it.each([0, 0.5, 1])('keeps N and S 2d apart and centered on the platform axis (t = %s)', (t) => {
    const axis = lerp(axisA, axisB, t)
    for (const nShape of north) {
      for (const sShape of south) {
        const qN = nearestOnPolyline(axis, nShape.points)
        const qS = nearestOnPolyline(axis, sShape.points)
        const label = `${nShape.id} / ${sShape.id}`
        expect(dist(qN, qS), label).toBeGreaterThan(2 * D - 0.1)
        expect(dist(qN, qS), label).toBeLessThan(2 * D + 0.1)
        expect(fromAxis(lerp(qN, qS, 0.5)), label).toBeLessThan(2)
      }
    }
  })

  it('puts each direction on its own platform track at the middle (NE is L08N)', () => {
    const midN = lerp(n.a, n.b, 0.5)
    const midS = lerp(s.a, s.b, 0.5)
    for (const shape of north) {
      expect(dist(midN, nearestOnPolyline(midN, shape.points)), shape.id).toBeLessThan(1.5)
      expect(dist(midS, nearestOnPolyline(midS, shape.points)), shape.id).toBeGreaterThan(5)
    }
    for (const shape of south) {
      expect(dist(midS, nearestOnPolyline(midS, shape.points)), shape.id).toBeLessThan(1.5)
      expect(dist(midN, nearestOnPolyline(midN, shape.points)), shape.id).toBeGreaterThan(5)
    }
  })
})

describe('the track line of every shape', () => {
  it('is finite, keeps the de-spurred point count, and never runs against its source segment', () => {
    for (const s of shapes) {
      const center = dropSpurs(decodeShapePoints(s).map((p) => toGround(p)))
      const out = trackLine(s, D)
      expect(out.length, s.id).toBe(center.length)
      for (let i = 0; i < out.length; i++) {
        const moved = dist(out[i]!, center[i]!)
        expect(Number.isFinite(moved), s.id).toBe(true)
        expect(moved, `${s.id} vertex ${i}`).toBeLessThanOrEqual(MITER_LIMIT * D + 1e-6)
        if (i === 0) continue
        const dot =
          (out[i]!.x - out[i - 1]!.x) * (center[i]!.x - center[i - 1]!.x) +
          (out[i]!.z - out[i - 1]!.z) * (center[i]!.z - center[i - 1]!.z)
        expect(dot, `${s.id} segment ${i}`).toBeGreaterThanOrEqual(0)
      }
    }
  })
})
