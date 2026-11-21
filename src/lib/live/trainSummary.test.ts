import { describe, expect, it } from 'vitest'
import type { RealtimeTrip } from '../../data/realtime'
import { lookup } from '../realtime/fixture'
import { goneNotice, trainSummary } from './trainSummary'

const ROUTES = new Map([
  ['1', { shortName: '1' }],
  ['FX', { shortName: 'FX' }],
])
const NAMES: Record<string, string> = { '101': 'South Ferry', '103': 'Dyckman St', '104': '207 St' }
const stationName = (id: string): string | undefined => NAMES[id]

function rt(route: string, arrivals: RealtimeTrip['arrivals']): RealtimeTrip {
  return {
    route,
    direction: 'N',
    tripId: 'x',
    startDate: null,
    trainId: null,
    assigned: true,
    stopId: null,
    status: null,
    timestamp: null,
    arrivals,
  }
}

describe('trainSummary', () => {
  it("names the joined pattern's terminal, not the feed's last predicted stop", () => {
    const s = trainSummary({ trip: rt('1', [['102N', 10]]), shapeId: '1..N03R' }, ROUTES, lookup.patterns, stationName)
    expect(s).toEqual({ routeId: '1', routeName: '1', headsign: 'Dyckman St' })
  })

  it('falls back to the last predicted stop without a pattern, and speaks express routes', () => {
    const s = trainSummary({ trip: rt('FX', [['102S', 10], ['101S', 20]]), shapeId: 'unknown' }, ROUTES, lookup.patterns, stationName)
    expect(s).toEqual({ routeId: 'FX', routeName: 'F express', headsign: 'South Ferry' })
  })

  it('leaves unknowns null', () => {
    const s = trainSummary({ trip: rt('Q', []), shapeId: 'unknown' }, ROUTES, lookup.patterns, stationName)
    expect(s).toEqual({ routeId: null, routeName: null, headsign: null })
  })
})

describe('goneNotice', () => {
  it('names the train when it can', () => {
    expect(goneNotice({ routeId: 'L', routeName: 'L', headsign: '8 Av' })).toBe('The L train to 8 Av is no longer tracked.')
    expect(goneNotice({ routeId: 'L', routeName: 'L', headsign: null })).toBe('The L train is no longer tracked.')
    expect(goneNotice(null)).toBe("Lost this train's live position.")
    expect(goneNotice({ routeId: null, routeName: null, headsign: 'X' })).toBe("Lost this train's live position.")
  })
})
