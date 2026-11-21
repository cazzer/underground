// Structural checks against the committed public/data, so schedule refreshes don't break them.
import { describe, expect, it } from 'vitest'
import shapesRaw from '../../../public/data/shapes.json?raw'
import stationsRaw from '../../../public/data/stations.json?raw'
import tripIndexRaw from '../../../public/data/trip-index.json?raw'
import type { ShapesFile, StationsFile, TripIndexFile } from '../../data/schema'
import { createSlotTable, reconcileSlots } from '../live/slots'
import { pointAtDistance } from './polyline'
import type { LiveTrip } from './prepareTrips'
import { joinTrip } from './joinTrip'
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

describe('primary fallback join on real data', () => {
  const lookup = buildTripLookup(index, shapes)
  const NOW = 1_795_228_554
  /** Predictions at the tail of `shapeId`'s stops, for a trip no static key matches (so it takes the fallback). */
  const tailOf = (shapeId: string, n: number) =>
    index.patterns[shapeId]!.stops.slice(-n).map((s, i) => [s, NOW + 60 * (i + 1)] as [string, number])
  const joined = (tripId: string, route: string, arrivals: [string, number][]) => {
    const r = joinTrip({ tripId, route, startDate: '20000101', stopId: arrivals[0]![0], arrivals }, lookup, NOW)
    if (!r.matched) throw new Error(r.reason)
    return r
  }

  it('picks a pattern that calls at every predicted stop when the primary misses some', () => {
    const arrivals = tailOf('A..S05R', 4)
    expect(index.patterns['A..S58R']!.stops).not.toContain(arrivals[3]![0])
    const r = joined('999999_A..S', 'A', arrivals)
    expect(r.stage).toBe('primary')
    const stops = index.patterns[r.shapeId]!.stops
    for (const [s] of arrivals) expect(stops).toContain(s)
  })

  it('keeps the primary when it covers the predicted stops as well as any other pattern', () => {
    expect(joined('999999_D..S', 'D', tailOf('D..S07R', 5)).shapeId).toBe('D..S07R')
  })

  it('breaks a tie toward the shape the trip had last poll, so it does not flap', () => {
    const arrivals = tailOf('D..S07R', 5)
    const r = joinTrip({ tripId: '999999_D..S', route: 'D', startDate: '20000101', stopId: arrivals[0]![0], arrivals }, lookup, NOW, 'D..S05R')
    expect(r).toMatchObject({ matched: true, shapeId: 'D..S05R' })
  })

  it('falls back to the primary when nothing is predicted', () => {
    const r = joinTrip({ tripId: '999999_D..S', route: 'D', startDate: '20000101', stopId: null, arrivals: [] }, lookup, NOW)
    expect(r).toEqual({ matched: true, shapeId: 'D..S07R', stage: 'primary' })
  })
})

describe('a trip moving between two shapes of the same route', () => {
  const geometries = buildShapeGeometries(shapes, index, stations)
  const lookup = buildTripLookup(index, shapes)

  it('never draws the dot somewhere else: it carries over within 25 m, or shrinks in place on the old shape', () => {
    const asTrip = (shapeId: string): LiveTrip =>
      ({
        key: 't',
        shapeId,
        geometry: geometries.get(shapeId)!,
        plan: { from: 0, to: 1, arriveAt: null, runS: 100, fixedFraction: 0, minFraction: 0, departsInS: null },
      }) as unknown as LiveTrip
    let pairs = 0
    let carried = 0
    let faded = 0
    for (const ids of lookup.patternsOf.values()) {
      for (const a of ids) {
        for (const b of ids) {
          if (a >= b) continue
          const ga = geometries.get(a)!
          // Every stop the two patterns share, plus a point partway to the next one.
          for (const [i, d] of ga.stopDistances.entries()) {
            if (!geometries.get(b)!.stops.includes(ga.stops[i]!)) continue
            pairs++
            const t = createSlotTable(1)
            const opts = { dataNow: 0, reducedMotion: false }
            reconcileSlots(t, [asTrip(a)], 0, opts)
            t.displayed[0] = d
            const before = pointAtDistance(ga.line, d).point
            reconcileSlots(t, [asTrip(b)], 1, opts)
            const after = pointAtDistance(t.drawGeometry[0]!.line, t.displayed[0]!).point
            expect(Math.hypot(after.x - before.x, after.z - before.z), `${a} -> ${b} at ${ga.stops[i]}`).toBeLessThanOrEqual(25)
            if (t.phase[0] === 1) faded++
            else carried++
          }
        }
      }
    }
    expect(pairs).toBeGreaterThan(1000)
    expect(carried + faded).toBe(pairs)
    expect(carried).toBeGreaterThan(0)
  })
})
