import { describe, expect, it } from 'vitest'
import { planOn, type TripLeg } from './plan'
import { route } from './raptor'
import type { ServiceWindow } from './serviceDay'
import { buildTimetable, makePatterns } from './patterns'
import { buildStopIndex } from './stops'
import { fixtureTimetable, m } from './timetableFixture'

const S = 1_800_000_000
const window: ServiceWindow = { date: '20270115', startS: S, frames: [] }
const rt = { timetable: fixtureTimetable(), window }

describe('planOn', () => {
  it('returns the router journeys with every time moved to epoch seconds', () => {
    const plain = route(rt.timetable, ['101'], ['104'], m(0))
    const planned = planOn(rt, ['101'], ['104'], S + m(0))
    expect(plain.length).toBeGreaterThan(0)
    expect(planned).toHaveLength(plain.length)
    plain.forEach((j, i) => {
      const t = planned[i]!
      expect([t.departAt, t.arriveAt, t.transfers]).toEqual([S + j.departS, S + j.arriveS, j.transfers])
      expect(t.legs).toHaveLength(j.legs.length)
      j.legs.forEach((leg, k) => {
        const tl: TripLeg = t.legs[k]!
        if (leg.kind === 'ride') {
          expect(tl).toMatchObject({ kind: 'ride', tripId: leg.tripId, departAt: S + leg.departS, arriveAt: S + leg.arriveS })
        } else {
          expect(tl).toMatchObject({ kind: 'walk', durationS: leg.durationS, startAt: S + leg.startS, endAt: S + leg.endS })
        }
      })
    })
  })

  it('leaves no router-second fields on a leg', () => {
    const [journey] = planOn(rt, ['101'], ['103'], S + m(0))
    for (const leg of journey!.legs) {
      expect(leg).not.toHaveProperty('departS')
      expect(leg).not.toHaveProperty('arriveS')
      expect(leg).not.toHaveProperty('startS')
      expect(leg).not.toHaveProperty('endS')
    }
  })

  it('names the last stop of the pattern on each ride, past where the rider gets off', () => {
    const journeys = planOn(rt, ['101'], ['102'], S + m(0))
    const ride = journeys[0]!.legs.find((l) => l.kind === 'ride')
    expect(ride).toMatchObject({ alightStop: '102N', terminalStop: '103N' })
  })

  it('resolves the terminal of a FIFO lane (key#1) through the timetable', () => {
    const index = buildStopIndex({ stopIds: ['101N', '102N', '103N'], changeS: new Map(), transfers: [] })
    const stops = ['101N', '102N', '103N']
    const slow = { id: 'slow', routeId: 'X', arr: [0, 100, 1200], dep: [0, 100, 1200] }
    const fast = { id: 'fast', routeId: 'X', arr: [60, 160, 600], dep: [60, 160, 600] }
    const lanes = makePatterns(index, { key: 'p', stops, trips: [slow, fast] })
    expect(lanes.map((p) => p.key)).toEqual(['p', 'p#1'])
    const lane = { timetable: buildTimetable(index, lanes), window }
    const [journey] = planOn(lane, ['101'], ['103'], S)
    expect(journey!.legs[0]).toMatchObject({ kind: 'ride', patternKey: 'p#1', terminalStop: '103N' })
  })
})
