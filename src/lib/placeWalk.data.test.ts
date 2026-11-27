/**
 * A place walk at Bedford Av (L08) on the committed interior, street file and walk shard (a6m): a searched place
 * about 200 m from the station, found as a node of the shard so the test doesn't hang on a street name. Properties, not
 * lengths: the daily refresh moves the data.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeStationWalk } from '../data/loadStationWalk'
import type { StationInterior } from '../data/stationSchema'
import type { StationStreets } from '../data/streetSchema'
import type { StationWalk } from '../data/walkSchema'
import { chooseEntry, chooseExit } from './exitChoice'
import { placeWalkSpan, type PlaceEnd } from './placeWalk'
import { toGround, type Ground } from './projection'
import { MAX_DETOUR } from './tripWalkPaths'

const read = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T
const interior = read<StationInterior>('public/data/stations/L08.json')
const walk = decodeStationWalk(read<StationWalk>('public/data/walk/L08.json'))
const streets = read<StationStreets>('public/data/streets/L08.json')
const origin = toGround(interior.anchor)
/** The station's point: the file anchor, which the walk and the street shards share. */
const station: Ground = walk.anchor

/** The shard's node nearest 200 m from the station. */
const place = ((): Ground => {
  let best = 0
  let bestGap = Infinity
  walk.x.forEach((x, i) => {
    const gap = Math.abs(Math.hypot(x, walk.z[i]!) - 200)
    if (gap < bestGap) [best, bestGap] = [i, gap]
  })
  return { x: walk.anchor.x + walk.x[best]!, z: walk.anchor.z + walk.z[best]! }
})()
const placeEnd: PlaceEnd = { place, stationId: 'L08', stop: 'L08N', point: station, stationIds: ['L08'] }
const straight = (a: Ground, b: Ground): number => Math.hypot(a.x - b.x, a.z - b.z)
const graph = { graph: walk, settled: true }

describe('a place walk at Bedford Av', () => {
  it('To: the exit chosen for the place, its street path to the place', () => {
    const choice = chooseExit({ interior, stopId: 'L08N', destination: place, walk, streets })
    if (choice.kind !== 'exit') throw new Error(choice.reason)
    const s = placeWalkSpan({ end: 'to', place: placeEnd, viaInterior: true, interiorOrigin: origin, choice, graph })
    if (s === 'pending') throw new Error('pending')
    expect(choice.walk?.kind).toBe('route')
    expect(s.path).toBeDefined()
    expect(s.to).toEqual(place)
    expect(s.path![0]).toEqual(s.from)
    expect(s.path!.at(-1)).toEqual(place)
    // From the exit's own entrance, which is near the station and not the station's point.
    expect(straight(s.from, station)).toBeLessThan(120)
  })

  it('From: the entrance chosen for the place, the street path running place to entrance', () => {
    const choice = chooseEntry({ interior, stopId: 'L08N', origin: place, walk, streets })
    if (choice.kind !== 'board') throw new Error(choice.reason)
    const s = placeWalkSpan({ end: 'from', place: placeEnd, viaInterior: true, interiorOrigin: origin, choice, graph })
    if (s === 'pending') throw new Error('pending')
    expect(s.from).toEqual(place)
    expect(s.path![0]).toEqual(place)
    const entrance = { x: origin.x + choice.exit.point[0], z: origin.z + choice.exit.point[1] }
    expect(s.to).toEqual(entrance)
    expect(s.path!.at(-1)).toEqual(entrance)
  })

  it('from the station point with no interior: along the streets, never shorter than the line nor past the detour cap', () => {
    const s = placeWalkSpan({ end: 'to', place: placeEnd, viaInterior: false, interiorOrigin: null, choice: undefined, graph })
    if (s === 'pending') throw new Error('pending')
    expect(s.path).toBeDefined()
    let meters = 0
    for (let i = 1; i < s.path!.length; i++) meters += straight(s.path![i - 1]!, s.path![i]!)
    expect(meters).toBeGreaterThanOrEqual(straight(station, place) - 1e-6)
    expect(meters).toBeLessThanOrEqual(straight(station, place) * MAX_DETOUR)
  })

  it('past the shard radius, a straight line', () => {
    const far = { x: station.x + walk.radiusM + 100, z: station.z }
    const s = placeWalkSpan({ end: 'to', place: { ...placeEnd, place: far }, viaInterior: false, interiorOrigin: null, choice: undefined, graph })
    expect(s).toMatchObject({ end: 'to', from: station, to: far, estimated: true })
  })
})
