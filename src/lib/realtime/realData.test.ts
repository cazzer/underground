// Structural checks against the committed public/data, so schedule refreshes don't break them.
import { describe, expect, it } from 'vitest'
import shapesRaw from '../../../public/data/shapes.json?raw'
import stationsRaw from '../../../public/data/stations.json?raw'
import tripIndexRaw from '../../../public/data/trip-index.json?raw'
import type { ShapesFile, StationsFile, TripIndexFile } from '../../data/schema'
import { buildShapeGeometries } from './shapeGeometry'
import { buildTripLookup } from './tripLookup'

const shapes = JSON.parse(shapesRaw) as ShapesFile
const stations = JSON.parse(stationsRaw) as StationsFile
const index = JSON.parse(tripIndexRaw) as TripIndexFile

describe('real public/data', () => {
  const geometries = buildShapeGeometries(shapes, index, stations)

  it('builds one geometry per pattern', () => {
    expect(geometries.size).toBe(Object.keys(index.patterns).length)
    expect(geometries.size).toBeGreaterThan(0)
  })
  it('has non-decreasing stop distances for every pattern', () => {
    for (const g of geometries.values()) {
      expect(g.stopDistances.length).toBe(g.stops.length)
      for (let i = 1; i < g.stopDistances.length; i++) {
        expect(g.stopDistances[i]!, `${g.shapeId} stop ${i}`).toBeGreaterThanOrEqual(g.stopDistances[i - 1]!)
      }
    }
  })
  it('keeps every stop close to its shape', () => {
    for (const g of geometries.values()) expect(g.maxStopOffsetM, g.shapeId).toBeLessThan(150)
  })
  it('builds a trip lookup with a primary shape per route and direction', () => {
    const lookup = buildTripLookup(index, shapes)
    expect(lookup.keys.size).toBe(Object.keys(index.origins).length)
    expect(lookup.primary.size).toBeGreaterThan(0)
    for (const shapeId of lookup.primary.values()) expect(index.patterns[shapeId]).toBeDefined()
  })
})
