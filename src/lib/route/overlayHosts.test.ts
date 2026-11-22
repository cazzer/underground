/** Overlay cases that need their own little timetables: hosting, short turns, and other service days. */
import { describe, expect, it } from 'vitest'
import { deltaEncode } from '../../data/codec'
import { index as tripIndex, lookup, shapes } from '../realtime/fixture'
import { buildTripLookup } from '../realtime/tripLookup'
import { serviceDayStart } from '../realtime/serviceDate'
import { NOW, overlayScheduled, rtTrip, snapshotOf } from './overlayFixture'
import { overlayRealtime } from './overlay'
import { buildTimetable, makePatterns, type PatternInput } from './patterns'
import type { Pattern, Timetable } from './types'

const base = overlayScheduled()
const trip = (id: string, ...t: number[]) => ({ id, routeId: '1', arr: t, dep: t })
const build = (...inputs: PatternInput[]): Timetable =>
  buildTimetable(base.stops, inputs.flatMap((p) => makePatterns(base.stops, p)))
const find = (tt: Timetable, key: string): Pattern => tt.patterns.find((p) => p.key === key)!
const rowOf = (p: Pattern, id: string): number[] => {
  const n = p.stops.length
  const i = p.tripIds.indexOf(id)
  return [...p.arr.subarray(i * n, (i + 1) * n)]
}

const GENERATED_AT = NOW - 4

describe('host choice', () => {
  it('lends run times from a host row the window cancelled, tail included', () => {
    const tt = build({ key: 'solo', stops: ['101N', '102N', '103N'], trips: [trip('1-2136', 77760, 77880, 78030)] })
    // Predictions stop at the horizon (79550): the schedule carries the last stop.
    const t = rtTrip('127000_1..N', '1', [['101N', 79490], ['102N', 79540]])
    const r = overlayRealtime(tt, {
      snapshot: snapshotOf({ '1234567': [t] }, { generatedAt: GENERATED_AT }),
      nowS: NOW,
      day: '20261120',
      lookup,
    })
    expect(r.counts).toMatchObject({ cancelled: 1, onHost: 1, oneOff: 0, extended: 1 })
    expect(find(r.timetable, 'solo').tripIds).toEqual(['1234567:127000_1..N'])
    expect(rowOf(find(r.timetable, 'solo'), '1234567:127000_1..N')).toEqual([79490, 79540, 79540 + 150])
  })

  it('tries the next host when the best one makes it a short turn', () => {
    const tt = build(
      { key: 'long', stops: ['101N', '102N', '103N', '104N'], trips: [trip('L', 80000, 80100, 80200, 80300)] },
      { key: 'tiny', stops: ['101N', '102N'], trips: [trip('T', 80000, 80100)] },
    )
    const t = rtTrip('100000_1..N', '1', [['101N', 78600], ['102N', 78720]])
    const r = overlayRealtime(tt, {
      snapshot: snapshotOf({ '1234567': [t] }, { generatedAt: GENERATED_AT }),
      nowS: NOW,
      day: '20261120',
      lookup,
    })
    // On `long` the run ends two stops short with the horizon far off; on `tiny` it reaches the last stop.
    expect(r.counts).toMatchObject({ onHost: 1, oneOff: 0 })
    expect(find(r.timetable, 'tiny').tripIds).toContain('1234567:100000_1..N')
    expect(find(r.timetable, 'long').tripIds).toEqual(['L'])
  })
})

describe('other service days', () => {
  /** A one-n pattern whose Weekday-after-midnight trip sits at `shifted` and one far later trip. */
  const dayTimetable = (shifted: number) =>
    build({
      key: 'one-n',
      stops: ['101N', '102N', '103N'],
      trips: [trip('shifted', shifted, shifted + 120, shifted + 270), trip('far', 50000, 50120, 50270)],
    })

  function overlayOn(day: string, tt: Timetable, firstArrival: number, lk = lookup) {
    const dayStart = serviceDayStart(day)
    const nowS = dayStart + firstArrival - 30
    const t = rtTrip('001000_1..N', '1', [['101N', 0], ['102N', 120], ['103N', 270]], {
      startDate: day,
      timestamp: nowS - 10,
    })
    t.arrivals = [['101N', dayStart + firstArrival + 60], ['102N', dayStart + firstArrival + 180], ['103N', dayStart + firstArrival + 330]]
    return overlayRealtime(tt, { snapshot: snapshotOf({ '1234567': [t] }, { generatedAt: nowS - 4 }), nowS, day, lookup: lk })
  }

  it('matches the previous day\'s 24:xx trip shifted onto the query day', () => {
    // Weekday 20261120's 24:10 trip (87000) is 600 s into 20261121's time base.
    const r = overlayOn('20261121', dayTimetable(600), 600)
    expect(r.counts).toMatchObject({ replaced: 1, onTwin: 1, oneOff: 0 })
    expect(find(r.timetable, 'one-n').tripIds).toEqual(['1234567:001000_1..N', 'far'])
  })

  it('shifts by the service days\' real start difference across the DST change', () => {
    // 20261101 has a 25-hour night: the previous day's 87000 is -3000 on its base, not 600.
    expect(serviceDayStart('20261101') - serviceDayStart('20261031')).toBe(90000)
    const origins = {
      ...tripIndex.origins,
      Saturday: { '1..N03R': deltaEncode([145000]) },
      Sunday: { '1..N03R': deltaEncode([700]) },
    }
    const calendar = { ...tripIndex.calendar, Saturday: { days: [6], start: '20261001', end: '20270515' } }
    const lk = buildTripLookup({ ...tripIndex, calendar, origins }, shapes)
    const r = overlayOn('20261101', dayTimetable(-3000), -3000, lk)
    expect(r.counts).toMatchObject({ replaced: 1, onTwin: 1, oneOff: 0 })
    expect(find(r.timetable, 'one-n').tripIds).not.toContain('shifted')
    // A shift of 86400 would put the twin 3600 s from the origin, outside the 120 s tolerance.
    const wrong = overlayOn('20261101', dayTimetable(600), -3000, lk)
    expect(wrong.counts.replaced).toBe(0)
  })
})
