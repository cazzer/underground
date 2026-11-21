/**
 * The map's tracks meet Bedford Av's (L08) interior rails, on the committed public/data at the default vertical
 * scale. Builds the lines the way network.ts does (trackLine, profileRuns, buildTrackProfile, resampleForProfile),
 * from the .ts-import modules Node can load. The daily refresh regenerates shapes, so bounds keep some headroom.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { ShapesFile, StationsFile } from '../../src/data/schema.ts'
import type { StationDepthsFile, StationInterior } from '../../src/data/stationSchema.ts'
import { toGround, type Ground } from '../../src/lib/projection.ts'
import { buildPolyline, projectForward } from '../../src/lib/realtime/polyline.ts'
import { profileRuns } from '../../src/lib/trackAnchors.ts'
import { trackLine } from '../../src/lib/trackLine.ts'
import { TRACK_OFFSET_M } from '../../src/lib/trackOffset.ts'
import { buildTrackProfile, GRADE, profileAt, resampleForProfile } from '../../src/lib/trackProfile.ts'
import { RAIL_DROP_M } from '../../src/lib/interiorGeometry.ts'

const readJson = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const shapes = (readJson('../../public/data/shapes.json') as ShapesFile).shapes
const stations = (readJson('../../public/data/stations.json') as StationsFile).stations
const depths = readJson('../../public/data/station-depths.json') as StationDepthsFile
const l08 = readJson('../../public/data/stations/L08.json') as StationInterior
const Y_SCALE = 2

const lines = shapes.map((s) => ({ id: s.id, routeId: s.routeId, direction: s.direction, line: buildPolyline(trackLine(s, TRACK_OFFSET_M)) }))
const { runs, unmatched } = profileRuns(
  depths,
  stations.map((s) => ({ id: s.id, routeIds: s.routes })),
  lines,
)
const drawn = new Map(
  lines.map(({ id, line }) => {
    const { profile } = buildTrackProfile(runs.get(id) ?? [], { grade: GRADE, yScale: Y_SCALE })
    return [id, { profile, ...resampleForProfile(line.points, line.cumulative, profile) }]
  }),
)

/** Nearest point on the drawn line to p: ground distance and the line's y there (linear between vertices, as drawn). */
function nearestDrawn(p: Ground, line: { points: Ground[]; y: number[] }): { offsetM: number; y: number } {
  let best = { offsetM: Infinity, y: 0 }
  for (let i = 1; i < line.points.length; i++) {
    const a = line.points[i - 1]!
    const b = line.points[i]!
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2))
    const offsetM = Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t))
    if (offsetM < best.offsetM) best = { offsetM, y: line.y[i - 1]! + (line.y[i]! - line.y[i - 1]!) * t }
  }
  return best
}

describe('Bedford Av (L08) track depth', () => {
  const anchor = toGround(l08.anchor)
  const platformY = l08.levels.find((l) => l.kind === 'platform')!.y
  const railY = (platformY - RAIL_DROP_M) * Y_SCALE
  const tracks = l08.platforms.flatMap((p) => p.tracks)
  /** L shapes in the stop's direction anchored to a platform run. */
  const riders = (stopId: string) => lines.filter((l) => l.routeId === 'L' && stopId.endsWith(l.direction) && runs.has(l.id))

  it('anchors every L08 track to at least one L shape, and nothing else is unmatched', () => {
    expect(unmatched).toEqual([])
    for (const t of tracks) expect(riders(t.stopId).length, t.stopId).toBeGreaterThan(0)
    // Every anchored shape is an L shape with exactly one run (it passes Bedford Av once).
    for (const [id, r] of runs) {
      expect(lines.find((l) => l.id === id)!.routeId, id).toBe('L')
      expect(r, id).toHaveLength(1)
    }
    expect(railY).toBeCloseTo(-20.4, 9)
  })

  it.each(['L08N', 'L08S'])('draws %s on the interior rails: within 1.75 m in 3D, level to 1 cm', (stopId) => {
    const path = tracks.find((t) => t.stopId === stopId)!.path
    const [first, last] = [path[0]!, path.at(-1)!]
    for (const rider of riders(stopId)) {
      const line = drawn.get(rider.id)!
      for (let i = 0; i <= 20; i++) {
        const t = i / 20
        const p = { x: anchor.x + first[0] + (last[0] - first[0]) * t, z: anchor.z + first[1] + (last[1] - first[1]) * t }
        const hit = nearestDrawn(p, line)
        const label = `${rider.id} at t = ${t}`
        expect(Math.abs(hit.y - railY), label).toBeLessThan(0.01)
        expect(Math.hypot(hit.offsetM, hit.y - railY), label).toBeLessThanOrEqual(1.75)
      }
    }
  })

  it('puts a train stopped at L08N at y = -20.4, and returns to the street far from the station', () => {
    const station = stations.find((s) => s.id === 'L08')!
    for (const rider of riders('L08N')) {
      const line = drawn.get(rider.id)!
      const at = projectForward(buildPolyline(line.points), toGround(station), { segment: 0, t: 0 })
      expect(profileAt(line.profile, at.distance), rider.id).toBeCloseTo(-20.4, 9)
      expect(line.y[0], rider.id).toBe(0)
      expect(line.y.at(-1), rider.id).toBe(0)
    }
  })

  it('leaves every other route flat', () => {
    for (const l of lines) if (l.routeId !== 'L') expect(drawn.get(l.id)!.y.every((y) => y === 0), l.id).toBe(true)
  })
})
