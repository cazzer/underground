import { describe, expect, it } from 'vitest'
import { lookup } from './fixture'
import { parseTripId } from '../../data/codec'
import { joinTrip, matchScheduled } from './joinTrip'

const NOW = 1795228554 // 2026-11-20 21:35 New York

function join(
  tripId: string,
  route: string,
  opts: { startDate?: string | null; stopId?: string | null; now?: number } = {},
) {
  return joinTrip(
    { tripId, route, startDate: opts.startDate === undefined ? '20261120' : opts.startDate, stopId: opts.stopId ?? null },
    lookup,
    opts.now ?? NOW,
  )
}
const hit = (shapeId: string, stage: string) => ({ matched: true, shapeId, stage })

describe('joinTrip', () => {
  it('joins by path code', () => {
    expect(join('129600_1..N03R', '1')).toEqual(hit('1..N03R', 'path'))
  })

  it('handles the single-dot SI id', () => {
    expect(join('126600_SI.S03R', 'SI')).toEqual(hit('SI..S03R', 'path'))
    expect(join('126600_SI.S', 'SI')).toEqual(hit('SI..S03R', 'tripKey'))
  })

  it('joins W trips that run on N shapes', () => {
    expect(join('123650_N..S70R', 'W')).toEqual(hit('N..S70R', 'path'))
    expect(join('128750_W..N', 'W')).toEqual(hit('N..N70R', 'tripKey'))
    expect(join('128750_N..N', 'W')).toEqual(hit('N..N70R', 'tripKey'))
  })

  it('uses startDate to pick the service', () => {
    expect(join('000600_1..N', '1', { startDate: '20261121' })).toEqual(hit('1..N03R', 'tripKey'))
    expect(join('000600_1..N', '1', { startDate: '20261120' })).toEqual(hit('1..N03R', 'primary'))
  })

  it('matches static after-midnight origins on the previous service day', () => {
    expect(join('001000_1..N', '1', { startDate: '20261121' })).toEqual(hit('1..N03R', 'tripKey'))
    expect(join('145000_1..N', '1', { startDate: '20261120' })).toEqual(hit('1..N03R', 'tripKey'))
  })

  it('follows holiday exceptions', () => {
    expect(join('000700_1..N', '1', { startDate: '20261126' })).toEqual(hit('1..N03R', 'tripKey'))
    expect(join('129600_1..N', '1', { startDate: '20261126' })).toEqual(hit('1..N03R', 'primary'))
  })

  it('falls back to the primary shape for supplemented trips and unknown paths', () => {
    expect(join('120416_1..N', '1')).toEqual(hit('1..N03R', 'primary'))
    expect(join('127550_1..N01X035', '1')).toEqual(hit('1..N03R', 'primary'))
  })

  it('resolves a colliding key by the train stop, then by primary', () => {
    expect(join('130000_1..N', '1', { stopId: '101N' })).toEqual(hit('1..N03R', 'tripKey'))
    expect(join('130000_1..N', '1', { stopId: '104N' })).toEqual(hit('1..N05R', 'tripKey'))
    expect(join('130000_1..N', '1', { stopId: '102N' })).toEqual(hit('1..N03R', 'tripKey'))
    expect(join('130000_1..N', '1')).toEqual(hit('1..N03R', 'tripKey'))
  })

  it('lands an N trip on the N shape even when the colliding W shape is primary', () => {
    expect(join('140000_N..S', 'N')).toEqual(hit('N..S72R', 'tripKey'))
    expect(join('140000_N..S', 'N', { stopId: '101S' })).toEqual(hit('N..S72R', 'tripKey'))
    expect(join('140000_N..S', 'W')).toEqual(hit('N..S70R', 'tripKey'))
  })

  it('prefers the primary shape even when it sorts after the non-primary one', () => {
    expect(join('131000_1..S', '1')).toEqual(hit('1..S03R', 'tripKey'))
    expect(join('131000_1..S', '1', { stopId: '102S' })).toEqual(hit('1..S03R', 'tripKey'))
  })

  it('reports unmatched trips explicitly', () => {
    expect(join('120000_X..N', 'X')).toEqual({ matched: false, reason: 'unknown-route' })
    expect(join('garbage', '1')).toEqual({ matched: false, reason: 'unparseable-id' })
  })

  it('guesses the service date from now when startDate is null', () => {
    expect(join('129600_1..N', '1', { startDate: null })).toEqual(hit('1..N03R', 'tripKey'))
  })

  it('falls back to the previous day when startDate is null just after New York midnight', () => {
    const afterMidnight = Date.UTC(2026, 10, 21, 5, 30) / 1000 // 00:30 EST Saturday
    expect(join('129600_1..N', '1', { startDate: null, now: afterMidnight })).toEqual(hit('1..N03R', 'tripKey'))
    // Same time of day with an explicit Saturday start date has no such trip.
    expect(join('129600_1..N', '1', { startDate: '20261121', now: afterMidnight })).toEqual(hit('1..N03R', 'primary'))
  })
})

describe('matchScheduled', () => {
  function match(tripId: string, route: string, startDate: string | null = '20261120') {
    return matchScheduled({ route, startDate }, parseTripId(tripId)!, lookup, NOW)
  }

  it('names the day, service, origin, route and shapes of a key hit', () => {
    expect(match('145000_1..N', '1')).toEqual({ day: '20261120', service: 'Weekday', origin: 145000, route: '1', shapes: ['1..N03R'] })
  })

  it('counts a 24:xx static origin from the day before', () => {
    expect(match('001000_1..N', '1', '20261121')).toEqual({
      day: '20261120',
      service: 'Weekday',
      origin: 145000,
      route: '1',
      shapes: ['1..N03R'],
    })
  })

  it('reports the route of the key that hit', () => {
    expect(match('128750_N..N', 'W')).toMatchObject({ route: 'N', shapes: ['N..N70R'] })
  })

  it('is null without a key', () => {
    expect(match('120416_1..N', '1')).toBeNull()
  })
})
