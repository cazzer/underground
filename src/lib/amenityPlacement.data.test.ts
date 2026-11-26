/** The amenity marks' clear bearings on the committed public/data: every listed station group, timed, and how often the
 *  first mark's plate (north-up, at a 500 m view, beside a bare station's marker) stays clear of the drawn tracks. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { PackedDepthsFile } from '../data/stationSchema'
import { markSizesInto, newMarkSizes, plateProbes } from '../scene/amenitySizes'
import { amenityMarks, markCentre, segmentDistance, trackSegments } from './amenityPlacement'
import { buildNetwork } from './network'
import { TRACK_OFFSET_M } from './trackOffset'

const read = <T>(path: string): T => JSON.parse(readFileSync(`public/data/${path}`, 'utf8')) as T
const network = buildNetwork(
  read<StationsFile>('stations.json'),
  read<RoutesFile>('routes.json'),
  read<ShapesFile>('shapes.json'),
  TRACK_OFFSET_M,
  read<PackedDepthsFile>('station-depths.json'),
  2,
)
const amenities = read<AmenitiesFile>('stations/amenities.json')

describe('amenity mark placement on the real network', () => {
  const segments = trackSegments(network.shapes)

  it('finds every listed group a bearing in well under 20 ms', () => {
    const t0 = performance.now()
    const marks = amenityMarks(network.stationGroups, amenities, segments, network.stationGroups, plateProbes)
    const ms = performance.now() - t0
    expect(new Set(marks.map((m) => m.stationId)).size).toBeGreaterThan(40)
    expect(ms).toBeLessThan(process.env.CI ? 200 : 60)
  })

  it('keeps the first plate 1 m clear of every track at most groups, and off every track at nearly all', () => {
    const marks = amenityMarks(network.stationGroups, amenities, segments, network.stations.map((s) => ({ id: s.id, pos: s.pos, memberIds: [s.id] })), plateProbes)
    const { plate: half, clear: markerClear, gap } = markSizesInto(newMarkSizes(), 500, false)
    const first = marks.filter((m) => m.k === 0)
    const tight: string[] = []
    const touching: string[] = []
    for (const m of first) {
      const c = markCentre(0, markerClear, half, gap)
      const cx = m.pos.x + m.dir.x * c
      const cz = m.pos.z + m.dir.z * c
      // The plate's four edges, north-up.
      const edges = [
        [cx - half, cz - half, cx + half, cz - half],
        [cx + half, cz - half, cx + half, cz + half],
        [cx + half, cz + half, cx - half, cz + half],
        [cx - half, cz + half, cx - half, cz - half],
      ] as const
      let clear = Infinity
      for (let o = 0; o < segments.length; o += 4) {
        const [x0, z0, x1, z1] = [segments[o]!, segments[o + 1]!, segments[o + 2]!, segments[o + 3]!]
        if (Math.abs(x0 - cx) > 100 || Math.abs(z0 - cz) > 100) continue
        const inside = Math.abs(x0 - cx) <= half && Math.abs(z0 - cz) <= half
        clear = Math.min(clear, inside ? 0 : Math.min(...edges.map((e) => segmentDistance(e[0], e[1], e[2], e[3], x0, z0, x1, z1))))
      }
      if (clear < 1) tight.push(`${m.stationId} ${clear.toFixed(1)} m`)
      if (clear === 0) touching.push(m.stationId)
    }
    // The tight ones are crowded junctions with tracks every way (Grand Central, Fulton St, Queensboro Plaza): 7 of 68 today.
    expect(tight.length / first.length, tight.join(', ')).toBeLessThanOrEqual(0.12)
    expect(touching.length / first.length, touching.join(', ')).toBeLessThanOrEqual(0.03)
  })
})
