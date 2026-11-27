/** The amenity marks' clear bearings on the committed public/data: the grid and every group timed on the scene's own
 *  inputs, and how often a row's plates (north-up, at a 500 m view, beside a bare station's marker) stay clear of the
 *  drawn tracks. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AmenitiesFile } from '../data/amenitiesSchema'
import type { RoutesFile, ShapesFile, StationsFile } from '../data/schema'
import type { PackedDepthsFile } from '../data/stationSchema'
import { markSizesInto, newMarkSizes, plateProbes } from '../scene/amenitySizes'
import { amenityMarks, groupMarks, rowCentreInto, squareDistance } from './amenityPlacement'
import { addShape, newTrackGrid, trackGrid } from './trackGrid'
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
  it('adds each shape to the grid, and lays out each group, in a few ms, as the idle slices in the scene do', () => {
    const grid = newTrackGrid()
    let gridWorst = 0
    let t0 = 0
    for (const s of network.shapes) {
      t0 = performance.now()
      addShape(grid, s.points)
      gridWorst = Math.max(gridWorst, performance.now() - t0)
    }
    let worst = 0
    let groups = 0
    for (const g of network.stationGroups) {
      t0 = performance.now()
      const marks = groupMarks(g, amenities, grid, network.stations, plateProbes)
      worst = Math.max(worst, performance.now() - t0)
      if (marks.length > 0) groups++
    }
    expect(groups).toBeGreaterThan(40)
    // About 13 ms for the whole grid, at most about 1 ms a shape, and at most about 6 ms a group (the first, cold) alone
    // on a laptop; the bounds only catch a blow-up, since the full suite runs files in parallel.
    expect(gridWorst).toBeLessThan(20)
    expect(worst).toBeLessThan(30)
  })

  it('keeps a row 1 m clear of every track at nineteen in twenty groups, and off every track at nearly all', () => {
    const grid = trackGrid(network.shapes)
    const { segments } = grid
    const marks = amenityMarks(network.stationGroups, amenities, grid, network.stations, plateProbes)
    const sizes = markSizesInto(newMarkSizes(), 500, false)
    const half = sizes.plate
    const clearOf = new Map<string, number>()
    const c = { x: 0, z: 0 }
    for (const m of marks) {
      rowCentreInto(c, m.k, m.n, m.pos, m.dir, sizes.clear, half, sizes.gap, 0)
      let clear = clearOf.get(m.stationId) ?? Infinity
      for (let o = 0; o < segments.length; o += 4) {
        if (Math.abs(segments[o]! - c.x) > 150 || Math.abs(segments[o + 1]! - c.z) > 150) continue
        clear = Math.min(clear, squareDistance(segments[o]!, segments[o + 1]!, segments[o + 2]!, segments[o + 3]!, c.x, c.z, half))
      }
      clearOf.set(m.stationId, clear)
    }
    const rows = [...clearOf]
    const tight = rows.filter(([, d]) => d < 1).map(([id, d]) => `${id} ${d.toFixed(1)} m`)
    const touching = rows.filter(([, d]) => d === 0).map(([id]) => id)
    // The tight ones are crowded junctions with tracks every way: Grand Central and Fulton St touch one, 2 of 68 today.
    expect(tight.length / rows.length, tight.join(', ')).toBeLessThanOrEqual(0.05)
    expect(touching.length / rows.length, touching.join(', ')).toBeLessThanOrEqual(0.03)
  })
})
