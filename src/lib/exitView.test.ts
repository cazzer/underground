import { describe, expect, it } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import type { StationStreets, StreetEntrance } from '../data/streetSchema'
import { entranceTexts } from './entranceText'
import { quickestExit, type ExitChoice } from './exitChoice'
import { exitLineView, finalRideStops, streetSpoken } from './exitView'
import { fixture } from './interiorFixture'
import { toGround } from './projection'
import type { TripJourney, TripLeg } from './route/plan'

const ride = (tripId: string, alightStop: string): TripLeg => ({
  kind: 'ride',
  routeId: 'L',
  tripId,
  patternKey: 'p',
  boardStop: 'L01N',
  alightStop,
  stops: ['L01N', alightStop],
  departAt: 0,
  arriveAt: 60,
  live: false,
  terminalStop: alightStop,
})
const walk: TripLeg = { kind: 'walk', fromStop: 'L08N', toStop: 'G29N', sameStation: false, startAt: 0, durationS: 60, endAt: 60 }
const journey = (...legs: TripLeg[]): TripJourney => ({ departAt: 0, arriveAt: 60, transfers: 0, legs })

describe('finalRideStops', () => {
  it('keeps the distinct last-ride stops in journey order, with their trips; a journey ending on foot has none', () => {
    const stops = finalRideStops([journey(ride('a', 'L08N')), journey(ride('b', 'L08N'), walk), journey(ride('c', 'G29S')), journey(ride('d', 'L08N'))])
    expect(stops).toEqual([
      { stopId: 'L08N', tripIds: ['a', 'd'] },
      { stopId: 'G29S', tripIds: ['c'] },
    ])
    expect(finalRideStops([])).toEqual([])
  })
})

const sources: Connector['sources'] = ['authored']
const PS1: Connector = { id: 'PS1', kind: 'stair', lower: { x: -10, z: 2, level: 'plat' }, upper: { x: -10, z: 8, level: 'mezz' }, width: 2, sources }
const EL1: Connector = { id: 'EL1', kind: 'elevator', lower: { x: 3, z: 2.5, level: 'plat' }, upper: { x: 3, z: 2.5, level: 'mezz' }, width: 2, sources }
const ST1: Connector = { id: 'ST1', kind: 'stair', lower: { x: 0, z: 10, level: 'mezz' }, upper: { x: 7, z: 10, level: 'street' }, width: 2, sources }

function station(connectors: Connector[], over: Partial<StationInterior> = {}): StationInterior {
  const base = fixture(connectors)
  return { ...base, slabs: [{ ...base.slabs[0]!, outline: [[-15, 2], [15, 2], [15, 15], [-15, 15]] }], ...over }
}
function exitOf(interior: StationInterior): ExitChoice {
  const r = quickestExit({ interior, stopId: 'X01N' })
  if (r.kind !== 'exit') throw new Error(r.reason)
  return r
}

/** A street file on the interior's own anchor: x/z in meters. */
function streets(interior: StationInterior, entrances: [number, number, Partial<StreetEntrance>][]): StationStreets {
  return {
    stationId: 'X01',
    anchor: interior.anchor,
    format: 1,
    license: 'ODbL-1.0',
    attribution: [],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300,
    walkRadiusM: 150,
    nodeId: [],
    x: [],
    z: [],
    ways: [],
    entrances: entrances.map(([x, z, e]) => ({
      x: x * 10, z: z * 10, type: 'Stair', entry: true, exit: true, stopIds: [], street: 'Bedford Avenue', wayId: 1,
      cross: 'North 7th Street', crossWayId: 2, side: 'NE', plaza: null, ...e,
    })),
  }
}

describe('exitLineView', () => {
  const interior = station([PS1, ST1])
  const choice = exitOf(interior)

  it('names the exit by its street label, the tail in the note', () => {
    const file = streets(interior, [[9, 10, {}]])
    const view = exitLineView(choice, interior, [{ file, labels: entranceTexts(file) }], true)
    expect(view.text).toBe('Quickest way out: Bedford Av & N 7 St')
    expect(view.note).toBe('NE corner')
    expect(view.spoken).toBe('Quickest way out: Bedford Avenue and North 7 Street, northeast corner.')
    expect(view.mapLabel).toEqual({ stationId: 'X01', index: 0 })
  })

  it('takes a complex member’s label when the first source has no entrance at the exit', () => {
    const empty = streets(interior, [])
    const member = { ...streets(interior, [[9, 10, {}]]), stationId: 'X02' }
    const view = exitLineView(choice, interior, [{ file: empty, labels: [] }, { file: member, labels: entranceTexts(member) }], true)
    expect(view.text).toBe('Quickest way out: Bedford Av & N 7 St')
    expect(view.mapLabel).toEqual({ stationId: 'X02', index: 0 })
  })

  it('takes a merged twin’s label, and words a point target as Exit at', () => {
    const file = streets(interior, [[20, 10, {}], [9, 10, {}]])
    const labels = entranceTexts(file)
    expect(labels.map((l) => l.index)).toEqual([0])
    const o = toGround(interior.anchor)
    const toward: ExitChoice = { ...choice, destination: { x: o.x + 60, z: o.z }, walk: { kind: 'route', points: [], meters: 150, seconds: 130 } }
    const view = exitLineView(toward, interior, [{ file, labels }], true)
    expect(view.text).toBe('Exit at Bedford Av & N 7 St')
    expect(view.mapLabel).toEqual({ stationId: 'X01', index: 0 })
    expect(view.note).toBe('NE corner · then 3 min walk')
    expect(view.spoken).toContain('Then a 3 minute walk.')
  })

  it('falls back to a compass way from the station without labels', () => {
    const view = exitLineView(choice, interior, [], true)
    expect(view.text).toMatch(/^Quickest way out: toward the (east|southeast|northeast)$/)
    expect(view.note).toBeNull()
    expect(view.mapLabel).toBeNull()
    const estimate: ExitChoice = { ...choice, destination: { x: 0, z: 0 }, walk: { kind: 'estimate', meters: 900, seconds: 700 } }
    const point = exitLineView(estimate, interior, [], true)
    expect(point.text).toMatch(/^Exit toward the /)
    expect(point.note).toBe('about 12 min walk')
  })

  it('says probably on an estimated layout', () => {
    const generated = station([PS1, ST1], { generated: { archetype: 'cut-cover-mezzanine', confidence: 0.9 } })
    const file = streets(generated, [[9, 10, {}]])
    const view = exitLineView(exitOf(generated), generated, [{ file, labels: entranceTexts(file) }], true)
    expect(view.note).toBe('NE corner · probably')
    expect(view.spoken.endsWith('Probably: the station layout is estimated.')).toBe(true)
  })

  it('says a machine’s status is unknown only when the route rides one and outages are not known', () => {
    const lift = station([EL1, ST1])
    const c = exitOf(lift)
    expect(c.connectorIds).toEqual(['EL1', 'ST1'])
    expect(exitLineView(c, lift, [], false).note).toBe('elevator status unknown')
    expect(exitLineView(c, lift, [], false).spoken).toContain('Elevator status unknown.')
    expect(exitLineView(c, lift, [], true).note).toBeNull()
    expect(exitLineView(choice, interior, [], false).note).toBeNull()
  })
})

describe('streetSpoken', () => {
  it.each([
    ['W 96 St', 'West 96 Street'],
    ['Bedford Av & N 7 St', 'Bedford Avenue and North 7 Street'],
    ['Broadway', 'Broadway'],
    ['St Nicholas Av', 'Saint Nicholas Avenue'],
    ['Park Av S', 'Park Avenue South'],
    ['Av S', 'Avenue S'],
    ['Central Park W', 'Central Park West'],
    ['Broadway & W 96 St', 'Broadway and West 96 Street'],
    ['west side at W 94 St', 'west side at West 94 Street'],
    ['NE corner', 'northeast corner'],
  ])('%s → %s', (text, spoken) => {
    expect(streetSpoken(text)).toBe(spoken)
  })
})
