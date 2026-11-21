import { describe, expect, it } from 'vitest'
import type { ToScreen } from '../pick'
import { geometries } from '../realtime/fixture'
import { pointAtDistance } from '../realtime/polyline'
import type { LiveTrip } from '../realtime/prepareTrips'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { consistFor } from './consist'
import { createSlotTable, type SlotTable } from './slots'
import { nearestTrain, trainScreenPoints, type TrainPickInput } from './trainPick'

/** Top-down orthographic, 1 px per meter: screen x is east, screen y is south. */
const ortho: ToScreen = (x, _y, z, out) => {
  out.x = x
  out.y = z
  return true
}

const NORTH = geometries.get('1..N03R')!
const SOUTH = geometries.get('1..S03R')!
const LOCAL_S = 100

function liveTrip(key: string, geometry: ShapeGeometry): LiveTrip {
  return {
    key,
    feed: '1234567',
    trip: {
      route: '1',
      direction: 'N',
      tripId: key,
      startDate: null,
      trainId: null,
      assigned: true,
      stopId: geometry.stops[1]!,
      status: 'IN_TRANSIT_TO',
      timestamp: null,
      arrivals: [],
    },
    shapeId: geometry.shapeId,
    stage: 'path',
    geometry,
    plan: { from: 0, to: 1, arriveAt: null, runS: 100, dwellS: 0, fixedFraction: 0.5, minFraction: 0, departsInS: null },
  }
}

/** Puts a fully faded-in trip in slot i at `shown` meters along its shape. */
function place(t: SlotTable, i: number, key: string, geometry: ShapeGeometry, shown: number): void {
  t.keys[i] = key
  t.trips[i] = liveTrip(key, geometry)
  t.byKey.set(key, i)
  t.drawGeometry[i] = geometry
  t.displayed[i] = shown
  t.bornAt[i] = 0
  t.high = Math.max(t.high, i + 1)
}

function input(t: SlotTable, mix: number): TrainPickInput {
  return { table: t, consistOf: () => consistFor('1'), y: 0.5, carHeightM: () => 4, mix, localS: LOCAL_S }
}

/** The ground point `along` meters past the dot at 1000 m on the northbound shape, shifted `east` meters. */
function near(along: number, east = 0): { x: number; y: number } {
  const p = pointAtDistance(NORTH.line, 1000 + along).point
  return { x: p.x + east, y: p.z }
}

describe('nearestTrain', () => {
  it('hits a dot within the radius and misses beyond it', () => {
    const t = createSlotTable(4)
    place(t, 0, 'a', NORTH, 1000)
    expect(nearestTrain(input(t, 0), ortho, near(0, 10))).toEqual({ index: 0, distancePx: expect.closeTo(10, 6) })
    expect(nearestTrain(input(t, 0), ortho, near(0, 17))).toBeNull()
  })

  it('hits the rear car far from the center once the cars unfold', () => {
    const t = createSlotTable(4)
    place(t, 0, 'a', NORTH, 1000)
    // A ten-car 1 train is 155 m long: 70 m back from its center is on the rear car.
    expect(nearestTrain(input(t, 1), ortho, near(-70, 5))?.index).toBe(0)
    expect(nearestTrain(input(t, 0), ortho, near(-70, 5))).toBeNull()
    expect(nearestTrain(input(t, 1), ortho, near(-100, 0))).toBeNull()
  })

  it('misses beside the line', () => {
    const t = createSlotTable(4)
    place(t, 0, 'a', NORTH, 1000)
    expect(nearestTrain(input(t, 1), ortho, near(-40, 30))).toBeNull()
  })

  it('takes the nearest of two trains', () => {
    const t = createSlotTable(4)
    place(t, 0, 'a', NORTH, 1000)
    place(t, 1, 'b', NORTH, 1012)
    expect(nearestTrain(input(t, 0), ortho, near(9))?.index).toBe(1)
    expect(nearestTrain(input(t, 0), ortho, near(3))?.index).toBe(0)
  })

  it('ignores leaving, faded, unplaced and empty slots', () => {
    const t = createSlotTable(4)
    place(t, 0, 'a', NORTH, 1000)
    place(t, 1, 'b', NORTH, 1000)
    place(t, 2, 'c', NORTH, 1000)
    t.leavingSince[0] = LOCAL_S + 10
    t.bornAt[1] = LOCAL_S
    t.displayed[2] = NaN
    t.high = 4
    expect(nearestTrain(input(t, 1), ortho, near(0))).toBeNull()
  })
})

describe('nearestTrain at a tilt', () => {
  it('hits the roof of a car, not only its floor line', () => {
    // Height shifts a point 10 px per meter across the (north-south) line: a 4 m roof is 40 px off the floor line.
    const tilted: ToScreen = (x, y, z, out) => {
      out.x = x + 10 * y
      out.y = z
      return true
    }
    const t = createSlotTable(2)
    place(t, 0, 'a', NORTH, 1000)
    const floor = near(-40)
    const roofClick = { x: floor.x + 5 + 40, y: floor.y }
    expect(nearestTrain(input(t, 1), tilted, roofClick)?.index).toBe(0)
    expect(nearestTrain({ ...input(t, 1), carHeightM: () => 0 }, tilted, roofClick)).toBeNull()
  })
})

describe('trainScreenPoints', () => {
  it('gives the dot, and the car ends once unfolded', () => {
    const t = createSlotTable(2)
    place(t, 0, 'a', SOUTH, 600)
    expect(trainScreenPoints(input(t, 0), 0, ortho)).toMatchObject({ rear: null, front: null })
    const p = trainScreenPoints(input(t, 1), 0, ortho)!
    expect(Math.hypot(p.front!.x - p.rear!.x, p.front!.y - p.rear!.y)).toBeCloseTo(155, 3)
    expect(nearestTrain(input(t, 1), ortho, p.rear!)?.index).toBe(0)
  })
})
