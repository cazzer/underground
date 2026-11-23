import { describe, expect, it } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import type { StationStreets } from '../data/streetSchema'
import { boardLineKey, drawnBoardStop, firstRideStops } from './boardView'
import { entranceTexts } from './entranceText'
import { quickestEntry, type BoardChoice } from './exitChoice'
import { exitEntranceIndex, exitLineView } from './exitView'
import { fixture } from './interiorFixture'
import type { TripJourney, TripLeg } from './route/plan'

const ride = (tripId: string, boardStop: string, alightStop = 'G29N'): TripLeg => ({
  kind: 'ride',
  routeId: 'L',
  tripId,
  patternKey: 'p',
  boardStop,
  alightStop,
  stops: [boardStop, alightStop],
  departAt: 0,
  arriveAt: 60,
  live: false,
  terminalStop: alightStop,
})
const walk = (fromStop: string, toStop: string): TripLeg => ({ kind: 'walk', fromStop, toStop, sameStation: false, startAt: 0, durationS: 60, endAt: 60 })
const journey = (...legs: TripLeg[]): TripJourney => ({ departAt: 0, arriveAt: 60, transfers: 0, legs })

/** From is the 14 St-Union Sq complex. */
const from = new Set(['635', 'L03', 'R20'])

describe('drawnBoardStop', () => {
  it("is the first ride's boarding stop at From, and null for a journey that walks to another station first", () => {
    expect(drawnBoardStop(journey(ride('a', 'L03N'), walk('G29N', 'G30N'), ride('b', 'G30N')), from)).toBe('L03N')
    expect(drawnBoardStop(journey(walk('L03N', 'L02N'), ride('a', 'L02N')), from)).toBeNull()
    expect(drawnBoardStop(journey(walk('L03N', 'L02N')), from)).toBeNull()
  })
})

describe('firstRideStops', () => {
  it('keeps the distinct first-ride stops at From in journey order, with their trips', () => {
    const stops = firstRideStops(
      [journey(ride('a', 'L03N')), journey(walk('635N', 'L02N'), ride('w', 'L02N')), journey(ride('b', '635S')), journey(ride('c', 'L03N')), journey(ride('a', 'L03N'))],
      from,
    )
    expect(stops).toEqual([
      { stopId: 'L03N', tripIds: ['a', 'c'] },
      { stopId: '635S', tripIds: ['b'] },
    ])
  })
})

describe('boardLineKey', () => {
  it('tells one trip apart by the station it is boarded at', () => {
    expect(boardLineKey('a', 'L03')).not.toBe(boardLineKey('a', 'L02'))
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
function boardOf(interior: StationInterior): BoardChoice {
  const r = quickestEntry({ interior, stopId: 'X01N' })
  if (r.kind !== 'board') throw new Error(r.reason)
  return r
}
/** A street file on the interior's own anchor with one entrance at (9, 10): Bedford Av & N 7 St, NE corner. */
function streets(interior: StationInterior): StationStreets {
  return {
    stationId: 'X01', anchor: interior.anchor, format: 1, license: 'ODbL-1.0', attribution: [], osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM: 300, walkRadiusM: 150, nodeId: [], x: [], z: [], ways: [],
    entrances: [{
      x: 90, z: 100, type: 'Stair', entry: true, exit: true, stopIds: [], street: 'Bedford Avenue', wayId: 1,
      cross: 'North 7th Street', crossWayId: 2, side: 'NE', plaza: null,
    }],
  }
}

describe('the way-in line', () => {
  const interior = station([PS1, ST1])

  it('names the entry by its street label, the tail in the note', () => {
    const file = streets(interior)
    const view = exitLineView(boardOf(interior), interior, [{ file, labels: entranceTexts(file) }], true)
    expect(view.text).toBe('Quickest way in: Bedford Av & N 7 St')
    expect(view.note).toBe('NE corner')
    expect(view.spoken).toBe('Quickest way in: Bedford Avenue and North 7 Street, northeast corner.')
    expect(exitEntranceIndex(view.mapLabel!, file)).toBe(0)
  })

  it('falls back to the way it lies from the station without labels', () => {
    expect(exitLineView(boardOf(interior), interior, [], true).text).toMatch(/^Quickest way in: (east|southeast|northeast) entrance$/)
  })

  it('says probably, and a machine’s unknown status, as the way out does', () => {
    const generated = station([EL1, ST1], { generated: { archetype: 'cut-cover-mezzanine', confidence: 0.9 } })
    const file = streets(generated)
    const view = exitLineView(boardOf(generated), generated, [{ file, labels: entranceTexts(file) }], false)
    expect(view.note).toBe('NE corner · probably · elevator status unknown')
    expect(view.spoken).toBe(
      'Quickest way in: Bedford Avenue and North 7 Street, northeast corner. Elevator status unknown. Probably: the station layout is estimated.',
    )
  })

  it('names machines of unknown status in the order the rider meets them', () => {
    const ES2: Connector = { ...ST1, id: 'ES2', kind: 'escalator' }
    const base = station([EL1, ES2])
    const lifts = { ...base, entrances: [{ ...base.entrances[0]!, connectors: ['ES2'] }] }
    const into = boardOf(lifts)
    expect(into.connectorIds).toEqual(['EL1', 'ES2'])
    expect(exitLineView(into, lifts, [], false).note).toBe('escalator and elevator status unknown')
  })
})
