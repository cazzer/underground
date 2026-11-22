import { describe, expect, it } from 'vitest'
import { planOn, type TripLeg } from './plan'
import { route } from './raptor'
import type { ServiceWindow } from './serviceDay'
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
})
