import { describe, expect, it } from 'vitest'
import { deltaDecode, parseTripId, shapeIdOf, tripKey } from '../../src/data/codec.ts'
import { fixtureFeed } from './fixture.ts'
import { buildTripIndex } from './tripIndex.ts'

describe('buildTripIndex', () => {
  const { file, skippedNoShape } = buildTripIndex(fixtureFeed())

  it('has one pattern per canonical shape with routeId, direction and ordered child stops', () => {
    expect(Object.keys(file.patterns)).toEqual(['1..S03R', '1..S04R', 'GS..N01R', 'N..S72R', 'N..S73R', 'SI..S03R'])
    expect(file.patterns['N..S72R']).toEqual({ routeId: 'W', direction: 'S', stops: ['B01S', 'B02S', 'B03S'] })
    expect(file.patterns['GS..N01R']?.stops).toEqual(['G01N', 'A02N'])
  })
  it('stores origins per service and shape, sorted, unique and delta-encoded', () => {
    expect(file.origins['Weekday']!['1..S03R']).toEqual([600, 2000])
    expect(file.origins['Saturday']!['N..S72R']).toEqual([1200, 148800])
    expect(deltaDecode(file.origins['Saturday']!['N..S72R']!)).toEqual([1200, 150000])
    expect(Object.keys(file.origins)).toEqual(['Saturday', 'Sunday', 'Weekday'])
  })
  it('drops duplicate origins within a service and shape', () => {
    const feed = fixtureFeed()
    const copy = feed.stopTimes.filter((r) => r.tripId === 'Weekday_000600_1..S03R').map((r) => ({ ...r, tripId: 'Weekday2_000600_1..S03R' }))
    feed.stopTimes.push(...copy)
    feed.trips.push({ id: 'Weekday2_000600_1..S03R', routeId: '1', serviceId: 'Weekday', direction: 'S', shapeId: '1..S03R' })
    expect(buildTripIndex(feed).file.origins['Weekday']!['1..S03R']).toEqual([600, 2000])
  })
  it('joins a realtime SI id to the static pattern and origin', () => {
    const live = parseTripId('000500_SI.S03R')!
    expect(file.patterns[shapeIdOf(live)]).toBeDefined()
    const [origin] = deltaDecode(file.origins['Weekday']!['SI..S03R']!)
    const stat = parseTripId('Weekday_000500_SI..S03R')!
    expect(tripKey(origin!, stat.route, stat.direction)).toBe(tripKey(live.origin, live.route, live.direction))
  })
  it('skips trips with an empty shape_id and counts them', () => {
    expect(skippedNoShape).toBe(1)
  })
  it('uses getUTCDay numbering for calendar days, ascending', () => {
    expect(file.calendar['Weekday']).toEqual({ days: [1, 2, 3, 4, 5], start: '20261101', end: '20270515' })
    expect(file.calendar['Sunday']!.days).toEqual([0])
  })
  it('sorts exceptions by date then service', () => {
    expect(file.calendarExceptions.map((e) => `${e.date} ${e.serviceId}`)).toEqual([
      '20261120 Sunday',
      '20261126 Sunday',
      '20261126 Weekday',
    ])
  })
  it('throws when a shape has two stop sequences', () => {
    const feed = fixtureFeed()
    feed.stopTimes.find((r) => r.tripId === 'Weekday_002600_1..S03R' && r.stopId === 'A02S')!.stopId = 'A03S'
    expect(() => buildTripIndex(feed)).toThrow(/1\.\.S03R/)
  })
  it('throws when the trip id disagrees with shape_id, naming the trip', () => {
    const feed = fixtureFeed()
    feed.trips.find((t) => t.id === 'Weekday_000600_1..S03R')!.shapeId = '1..S04R'
    expect(() => buildTripIndex(feed)).toThrow(/Weekday_000600_1\.\.S03R.*shape/)
  })
  it('throws when the trip id direction disagrees with direction_id, naming the trip', () => {
    const feed = fixtureFeed()
    feed.trips.find((t) => t.id === 'Weekday_000600_1..S03R')!.direction = 'N'
    expect(() => buildTripIndex(feed)).toThrow(/Weekday_000600_1\.\.S03R.*direction/)
  })
  it('throws on a trip with no stop_times', () => {
    const feed = fixtureFeed()
    feed.stopTimes = feed.stopTimes.filter((r) => r.tripId !== 'Weekday_000100_GS.N01R')
    expect(() => buildTripIndex(feed)).toThrow(/no stop_times/)
  })
})
