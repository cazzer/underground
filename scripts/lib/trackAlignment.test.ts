/**
 * Checks offset shapes against the committed public/data, which the daily refresh regenerates:
 * assertions stick to what the offset controls, with headroom for small shape changes.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeShapePoints } from '../../src/data/codec.ts'
import type { ShapesFile, StationsFile, StopId, TripIndexFile } from '../../src/data/schema.ts'
import type { StationInterior } from '../../src/data/stationSchema.ts'
import { toGround, type Ground } from '../../src/lib/projection.ts'
import { dropSpurs, trackLine } from '../../src/lib/trackLine.ts'
import { MITER_LIMIT, TRACK_OFFSET_M } from '../../src/lib/trackOffset.ts'

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const shapes = (readJson('../../public/data/shapes.json') as ShapesFile).shapes
const l08 = readJson('../../public/data/stations/L08.json') as StationInterior
const patterns = (readJson('../../public/data/trip-index.json') as TripIndexFile).patterns
const stationOfStop = new Map<StopId, { id: string; pos: Ground }>()
for (const st of (readJson('../../public/data/stations.json') as StationsFile).stations) {
  for (const stop of st.stops) stationOfStop.set(stop, { id: st.id, pos: toGround(st) })
}
const D = TRACK_OFFSET_M

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

// Measured at 4.7 m: the offset L sits 1.25 m from each platform track at its middle, and
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
        expect(moved, `${s.id} vertex ${i}`).toBeGreaterThanOrEqual(D - 1e-6)
        expect(moved, `${s.id} vertex ${i}`).toBeLessThanOrEqual(MITER_LIMIT * D + 1e-6)
        if (i === 0) continue
        const dot =
          (out[i]!.x - out[i - 1]!.x) * (center[i]!.x - center[i - 1]!.x) +
          (out[i]!.z - out[i - 1]!.z) * (center[i]!.z - center[i - 1]!.z)
        expect(dot, `${s.id} segment ${i}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  // Guards dropSpurs against eating real track: a refresh with a sparsely sampled tight curve
  // would pull the line off its stations or drop many vertices. Measured against the raw shape,
  // because some station points already sit off it (Q05, 96 St, is 104 m past the Q shapes' end).
  // Fall 2026: worst move R23 at 10.9 m (0.3 → 11.2 m), at most 6 vertices dropped (N..N20R/S20R).
  it('stays near every station of its pattern and drops only a few vertices', () => {
    for (const s of shapes) {
      const raw = decodeShapePoints(s).map((p) => toGround(p))
      const center = dropSpurs(raw)
      expect(raw.length - center.length, s.id).toBeLessThanOrEqual(8)
      const pattern = patterns[s.id]
      if (!pattern) throw new Error(`No trip-index pattern for shape ${s.id}`)
      for (const stop of pattern.stops) {
        const station = stationOfStop.get(stop)
        if (!station) throw new Error(`Shape ${s.id} calls at unknown stop ${stop}`)
        const before = dist(station.pos, nearestOnPolyline(station.pos, raw))
        const after = dist(station.pos, nearestOnPolyline(station.pos, center))
        expect(after - before, `${s.id} at ${station.id}`).toBeLessThan(15)
      }
    }
  })
})
