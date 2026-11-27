import { describe, expect, it } from 'vitest'
import type { BoardChoice, ExitChoice } from './exitChoice'
import type { Ground } from './projection'
import type { TripJourney, TripLeg } from './route/plan'
import type { TripPlaces } from './trip'
import { placeEndsOf, placeWalkSpan, type PlaceEnd, type PlaceEndsInput, type PlaceWalkInput } from './placeWalk'
import { walkGraph } from './walkFixture'

const ride = (boardStop: string, alightStop: string): TripLeg => ({
  kind: 'ride',
  routeId: 'L',
  tripId: 't',
  patternKey: 'p',
  boardStop,
  alightStop,
  stops: [boardStop, alightStop],
  departAt: 0,
  arriveAt: 60,
  live: false,
  terminalStop: alightStop,
})
const walkLeg = (fromStop: string, toStop: string): TripLeg => ({ kind: 'walk', fromStop, toStop, sameStation: false, startAt: 0, durationS: 60, endAt: 60 })
const journey = (...legs: TripLeg[]): TripJourney => ({ departAt: 0, arriveAt: 60, transfers: 0, legs })

const st = (id: string, leadId: string, x: number, z: number) => ({ id, leadId, pos: { x, z } })
const stops = new Map([
  ['A1N', st('A1', 'A1', 0, 0)],
  ['A2N', st('A2', 'A1', 30, 0)],
  ['B1N', st('B1', 'B1', 500, 0)],
  ['C1N', st('C1', 'C1', 900, 0)],
])
const leadOf = (id: string): string => (id === 'A2' ? 'A1' : id)
const place: Ground = { x: 40, z: 40 }
const places = (over: Partial<TripPlaces> = {}): TripPlaces => ({ from: { note: 'Home', ground: place }, to: { note: 'Work', ground: place }, ...over })

function input(over: Partial<PlaceEndsInput> = {}): PlaceEndsInput {
  return { journey: journey(ride('A1N', 'B1N')), ends: { from: 'A1', to: 'B1' }, places: places(), fixEnd: null, stops, leadOf, ...over }
}

describe('placeEndsOf', () => {
  it("gives each end with a place the journey's first and last stop station, point and the place", () => {
    const e = placeEndsOf(input())
    expect(e.from).toEqual({ place, stationId: 'A1', stop: 'A1N', point: { x: 0, z: 0 } })
    expect(e.to).toEqual({ place, stationId: 'B1', stop: 'B1N', point: { x: 500, z: 0 } })
  })

  it('reads a walk leg at either end of the journey', () => {
    const j = journey(walkLeg('A2N', 'A1N'), ride('A1N', 'B1N'), walkLeg('B1N', 'B1N'))
    expect(placeEndsOf(input({ journey: j })).from?.stop).toBe('A2N')
  })

  it('has no walk for an end with no place, a "My location" place or an end filled from the fix', () => {
    expect(placeEndsOf(input({ places: places({ from: null }) })).from).toBeNull()
    expect(placeEndsOf(input({ places: places({ from: { note: 'you', ground: null } }) })).from).toBeNull()
    expect(placeEndsOf(input({ fixEnd: 'from' })).from).toBeNull()
    expect(placeEndsOf(input({ fixEnd: 'from' })).to).not.toBeNull()
  })

  it('has none with no journey, or for a journey station outside the end\'s complex', () => {
    expect(placeEndsOf(input({ journey: null }))).toEqual({ from: null, to: null })
    // The journey boards at C1, which is not the From end's complex.
    expect(placeEndsOf(input({ journey: journey(ride('C1N', 'B1N')) })).from).toBeNull()
    // The same complex's other member is fine.
    expect(placeEndsOf(input({ journey: journey(ride('A2N', 'B1N')) })).from?.stationId).toBe('A2')
  })

  it('has none for an unknown stop or an unset end', () => {
    expect(placeEndsOf(input({ journey: journey(ride('ZZN', 'B1N')) })).from).toBeNull()
    expect(placeEndsOf(input({ ends: { from: null, to: 'B1' } })).from).toBeNull()
  })
})

describe('placeWalkSpan', () => {
  /** One long sidewalk along z = 40 around the origin station's anchor. */
  const street = walkGraph([[-100, 40], [300, 40]], [{ nodes: [0, 1] }])
  const at = (x: number, z: number): Ground => ({ x: street.anchor.x + x, z: street.anchor.z + z })
  const end = (over: Partial<PlaceEnd> = {}): PlaceEnd => ({ place: at(100, 40), stationId: 'A1', stop: 'A1N', point: at(0, 0), ...over })
  const base = (over: Partial<PlaceWalkInput> = {}): PlaceWalkInput => ({
    end: 'to',
    place: end(),
    viaInterior: false,
    interiorOrigin: null,
    choice: undefined,
    graph: { graph: street, settled: true },
    ...over,
  })
  const exit = (walk: ExitChoice['walk']): ExitChoice => ({ kind: 'exit', exit: { point: [9, 10] }, walk }) as unknown as ExitChoice
  const entry = (walk: BoardChoice['walk']): BoardChoice => ({ kind: 'board', exit: { point: [9, 10] }, walk }) as unknown as BoardChoice

  it('is pending until the graph settles, the index is known and an interior\'s choice exists', () => {
    expect(placeWalkSpan(base({ graph: { graph: null, settled: false } }))).toBe('pending')
    expect(placeWalkSpan(base({ viaInterior: null }))).toBe('pending')
    expect(placeWalkSpan(base({ viaInterior: true, choice: undefined }))).toBe('pending')
  })

  it('routes the station point over the graph with no interior, To running station to place', () => {
    const s = placeWalkSpan(base())
    if (s === 'pending') throw new Error('pending')
    expect(s.end).toBe('to')
    expect(s.from).toEqual(at(0, 0))
    expect(s.to).toEqual(at(100, 40))
    expect(s.path).toEqual([at(0, 0), at(0, 40), at(100, 40)])
  })

  it('runs From place to station, along the reversed path', () => {
    const s = placeWalkSpan(base({ end: 'from' }))
    if (s === 'pending') throw new Error('pending')
    expect(s.from).toEqual(at(100, 40))
    expect(s.to).toEqual(at(0, 0))
    expect(s.path).toEqual([at(100, 40), at(0, 40), at(0, 0)])
  })

  it('draws straight past the graph radius, with no graph, or when it settled empty', () => {
    const far = end({ place: at(900, 0) })
    expect(placeWalkSpan(base({ place: far }))).toEqual({ end: 'to', from: at(0, 0), to: at(900, 0) })
    expect(placeWalkSpan(base({ graph: { graph: null, settled: true } }))).toEqual({ end: 'to', from: at(0, 0), to: at(100, 40) })
  })

  it("reuses an exit's street walk through an interior, and the way in's, which already runs place to entrance", () => {
    const points = [at(9, 10), at(9, 40), at(100, 40)]
    const out = placeWalkSpan(base({ viaInterior: true, interiorOrigin: at(0, 0), choice: exit({ kind: 'route', points, meters: 100, seconds: 80 }) }))
    expect(out).toEqual({ end: 'to', from: at(9, 10), to: at(100, 40), path: points })
    const back = [at(100, 40), at(9, 40), at(9, 10)]
    const inn = placeWalkSpan(base({ end: 'from', viaInterior: true, interiorOrigin: at(0, 0), choice: entry({ kind: 'route', points: back, meters: 100, seconds: 80 }) }))
    expect(inn).toEqual({ end: 'from', from: at(100, 40), to: at(9, 10), path: back })
  })

  it("estimates a straight line from the exit or entrance point when the choice's place was past the graph", () => {
    const est = { kind: 'estimate', meters: 1, seconds: 1 } as const
    const o = at(0, 0)
    expect(placeWalkSpan(base({ viaInterior: true, interiorOrigin: o, choice: exit(est) }))).toEqual({ end: 'to', from: at(9, 10), to: at(100, 40) })
    expect(placeWalkSpan(base({ end: 'from', viaInterior: true, interiorOrigin: o, choice: entry(est) }))).toEqual({ end: 'from', from: at(100, 40), to: at(9, 10) })
  })

  it('falls back to the station point when the interior has no way out or in', () => {
    const s = placeWalkSpan(base({ viaInterior: true, interiorOrigin: at(0, 0), choice: null }))
    if (s === 'pending') throw new Error('pending')
    expect(s.from).toEqual(at(0, 0))
    expect(s.path).toHaveLength(3)
  })
})
