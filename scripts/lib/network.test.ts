import { describe, expect, it } from 'vitest'
import { fixtureFeed } from './fixture.ts'
import { buildRoutes, buildStations, buildTransfers } from './network.ts'

describe('buildStations', () => {
  const stations = buildStations(fixtureFeed())
  it('lists only parent stations, sorted by id', () => {
    expect(stations.map((s) => s.id)).toEqual(['A01', 'A02', 'A03', 'B01', 'B02', 'B03', 'G01', 'Z99'])
  })
  it('rounds lat/lon to 5 dp', () => {
    expect(stations[0]).toMatchObject({ id: 'A01', name: 'Alpha St', lat: 40.70001, lon: -74 })
    expect(stations[1]!.lat).toBe(40.701)
  })
  it('sorts child stops', () => {
    expect(stations[2]!.stops).toEqual(['A03N', 'A03S'])
  })
  it('unions routes over trips, in route_sort_order, using trip route_id', () => {
    expect(stations[0]!.routes).toEqual(['SI', '1'])
    expect(stations[1]!.routes).toEqual(['SI', 'GS', '1'])
    expect(stations[3]!.routes).toEqual(['W'])
  })
  it('gives an unserved station no routes', () => {
    expect(stations.at(-1)).toMatchObject({ id: 'Z99', routes: [] })
  })
  it('throws on a stop_time at an unknown stop', () => {
    const feed = fixtureFeed()
    feed.stopTimes[0]!.stopId = 'NOPE'
    expect(() => buildStations(feed)).toThrow(/NOPE/)
  })
})

describe('buildRoutes', () => {
  const routes = buildRoutes(fixtureFeed())
  it('follows route_sort_order', () => {
    expect(routes.map((r) => r.id)).toEqual(['SI', 'GS', 'W', '1'])
  })
  it('defaults blank colors to FFFFFF / 000000', () => {
    expect(routes[0]).toMatchObject({ shortName: 'SIR', color: 'FFFFFF', textColor: '000000' })
  })
  it('uppercases hex and keeps the long name', () => {
    expect(routes[2]).toMatchObject({ id: 'W', color: 'FCCC0A', longName: 'Broadway Local' })
  })
  it('throws on a malformed color', () => {
    const feed = fixtureFeed()
    feed.routes[0]!.color = 'blue'
    expect(() => buildRoutes(feed)).toThrow(/route_color/)
  })
})

describe('buildTransfers', () => {
  it('drops self-transfers and sorts by from then to', () => {
    expect(buildTransfers(fixtureFeed())).toEqual([
      { from: 'A01', to: 'A02', minTransferSec: 120 },
      { from: 'A02', to: 'A01', minTransferSec: 180 },
      { from: 'B01', to: 'A01', minTransferSec: 60 },
    ])
  })
  it('throws on a blank min_transfer_time', () => {
    const feed = fixtureFeed()
    feed.transfers[0]!.minTransferTime = ''
    expect(() => buildTransfers(feed)).toThrow(/min_transfer_time/)
  })
})
