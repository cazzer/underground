import { describe, expect, it } from 'vitest'
import { buildTimetable, makePatterns } from './patterns'
import { route } from './raptor'
import { buildStopIndex } from './stops'
import { fixtureTimetable, m } from './timetableFixture'
import type { Journey, RideLeg, WalkLeg } from './types'

const tt = fixtureTimetable()

/** Every journey: legs alternate ride and walk, no ride leaves before the leg before it ends, a walk is as long as
 *  its footpath, a walk starts where the leg before it ends, and transfers is the ride count minus one. */
function expectWellFormed(table: typeof tt, journeys: Journey[]): void {
  const { stopOf, footStart, footTo, footS } = table.stops
  for (const j of journeys) {
    j.legs.forEach((leg, i) => {
      const prev = j.legs[i - 1]
      if (prev) expect(leg.kind).not.toBe(prev.kind)
      if (leg.kind === 'ride') {
        if (prev?.kind === 'walk') expect(leg.departS).toBeGreaterThanOrEqual(prev.endS)
        expect(leg.stops[0]).toBe(leg.boardStop)
        expect(leg.stops[leg.stops.length - 1]).toBe(leg.alightStop)
      } else {
        if (prev?.kind === 'ride') expect(leg.startS).toBe(prev.arriveS)
        const from = stopOf.get(leg.fromStop)!
        let seconds = -1
        for (let e = footStart[from]!; e < footStart[from + 1]!; e++) if (footTo[e] === stopOf.get(leg.toStop)) seconds = footS[e]!
        expect(leg.durationS).toBe(seconds)
        expect(leg.endS).toBe(leg.startS + leg.durationS)
      }
    })
    expect(j.transfers).toBe(Math.max(0, j.legs.filter((l) => l.kind === 'ride').length - 1))
    expect(j.arriveS).toBe(j.legs[j.legs.length - 1]!.kind === 'ride' ? (j.legs[j.legs.length - 1] as RideLeg).arriveS : (j.legs[j.legs.length - 1] as WalkLeg).endS)
  }
}

const summary = (js: Journey[]) => js.map((j) => ({ arriveS: j.arriveS, transfers: j.transfers }))
const rides = (j: Journey) => j.legs.filter((l): l is RideLeg => l.kind === 'ride')
const walks = (j: Journey) => j.legs.filter((l): l is WalkLeg => l.kind === 'walk')

describe('route', () => {
  it('rides a direct trip', () => {
    const js = route(tt, ['101'], ['103'], m(0))
    expectWellFormed(tt, js)
    expect(js).toHaveLength(1)
    expect(js[0]).toMatchObject({ departS: m(0), arriveS: m(4.5), transfers: 0 })
    expect(js[0]!.legs).toEqual([
      {
        kind: 'ride',
        routeId: 'W',
        tripId: 'W-0800',
        patternKey: 'main-n',
        boardStop: '101N',
        alightStop: '103N',
        stops: ['101N', '102N', '103N'],
        departS: m(0),
        arriveS: m(4.5),
      },
    ])
  })

  it('reports the route of the trip when two routes share a pattern', () => {
    const js = route(tt, ['101'], ['103'], m(6))
    expect(js).toHaveLength(1)
    expect(rides(js[0]!)[0]).toMatchObject({ routeId: '1', tripId: '1-0810', arriveS: m(14.5) })
  })

  it('changes at a station, waiting out the minimum change time', () => {
    const js = route(tt, ['101'], ['104'], m(0))
    expectWellFormed(tt, js)
    const fastest = js[js.length - 1]!
    expect(fastest.arriveS).toBe(m(10.5))
    expect(fastest.legs).toHaveLength(3)
    expect(fastest.legs[0]).toMatchObject({ kind: 'ride', routeId: 'W', boardStop: '101N', alightStop: '102N', arriveS: m(2) })
    expect(fastest.legs[1]).toEqual({
      kind: 'walk',
      fromStop: '102N',
      toStop: '102N',
      sameStation: true,
      startS: m(2),
      durationS: 180,
      endS: m(5),
    })
    // 1x-0804 leaves 102 at m4, before the change is done
    expect(fastest.legs[2]).toMatchObject({ kind: 'ride', tripId: '1x-0806', alightStop: '104N', departS: m(6), arriveS: m(10.5) })
  })

  it('takes the earlier connection when the change time is shorter, boundary inclusive', () => {
    const quick = (seconds: number) => route(fixtureTimetable(new Map([['102', seconds]])), ['101'], ['104'], m(0))
    const at60 = quick(60)
    const at120 = quick(120)
    expect(at60[at60.length - 1]!.arriveS).toBe(m(8.5))
    expect(at120[at120.length - 1]!.arriveS).toBe(m(8.5))
    expect(rides(at120[at120.length - 1]!)[1]).toMatchObject({ tripId: '1x-0804', departS: m(4) })
    expect(quick(121).at(-1)!.arriveS).toBe(m(10.5))
  })

  it('returns the Pareto set, fewest transfers first', () => {
    expect(summary(route(tt, ['101'], ['104'], m(0)))).toEqual([
      { arriveS: m(12), transfers: 0 },
      { arriveS: m(10.5), transfers: 1 },
    ])
  })

  it('transfers between stations on foot', () => {
    const js = route(tt, ['101'], ['S01'], m(0))
    expectWellFormed(tt, js)
    expect(summary(js)).toEqual([
      { arriveS: m(34.5), transfers: 1 },
      { arriveS: m(19.5), transfers: 2 },
    ])
    const legs = js[1]!.legs
    expect(legs.map((l) => l.kind)).toEqual(['ride', 'walk', 'ride', 'walk', 'ride'])
    expect(legs[1]).toMatchObject({ sameStation: true })
    expect(legs[3]).toEqual({
      kind: 'walk',
      fromStop: '104N',
      toStop: 'S03S',
      sameStation: false,
      startS: m(10.5),
      durationS: 240,
      endS: m(14.5),
    })
    expect(legs[4]).toMatchObject({ routeId: 'SI', tripId: 'SI-0815', departS: m(15), arriveS: m(19.5) })
    // the 1-transfer journey misses SI-0815 (ready at S03 at m16) and takes the next one
    expect(rides(js[0]!)[1]).toMatchObject({ tripId: 'SI-0830' })
  })

  it('ends with a walk when the target is reached on foot', () => {
    const js = route(tt, ['101'], ['S03'], m(0))
    expectWellFormed(tt, js)
    expect(summary(js)).toEqual([
      { arriveS: m(16), transfers: 0 },
      { arriveS: m(14.5), transfers: 1 },
    ])
    for (const j of js) {
      expect(j.legs.at(-1)).toMatchObject({ kind: 'walk', fromStop: '104N', sameStation: false, durationS: 240 })
      expect(['S03N', 'S03S']).toContain((j.legs.at(-1) as WalkLeg).toStop)
    }
  })

  it('walks the whole way when that is fastest', () => {
    const js = route(tt, ['S03'], ['104'], m(0))
    expectWellFormed(tt, js)
    expect(js).toHaveLength(1)
    expect(js[0]).toMatchObject({ departS: m(0), arriveS: m(4), transfers: 0 })
    expect(js[0]!.legs).toHaveLength(1)
    expect(js[0]!.legs[0]).toMatchObject({ kind: 'walk', sameStation: false, startS: m(0), durationS: 240 })
  })

  it('seeds every station of a complex', () => {
    const js = route(tt, ['101', '102'], ['104'], m(4))
    expect(js.at(-1)).toMatchObject({ arriveS: m(8.5), transfers: 0 })
    expect(rides(js.at(-1)!)[0]).toMatchObject({ tripId: '1x-0804', boardStop: '102N' })
  })

  it('boards a trip past midnight', () => {
    const js = route(tt, ['101'], ['103'], 86700)
    expect(js).toHaveLength(1)
    expect(rides(js[0]!)[0]).toMatchObject({ tripId: 'W-2410', departS: 87000, arriveS: 87270 })
  })

  it('rounds a fractional departure up', () => {
    // 0.5 s after W-0800 left: rounding down would board it, rounding up takes 1t-0801
    expect(route(tt, ['101'], ['103'], m(0) + 0.5)[0]?.arriveS).toBe(m(5.5))
  })

  it('finds nothing when there is no way', () => {
    expect(route(tt, ['S01'], ['101'], m(0))).toEqual([])
    expect(route(tt, ['101'], ['103'], 87001)).toEqual([])
    expect(route(tt, ['101'], ['101'], m(0))).toEqual([])
    expect(route(tt, ['101', '102'], ['102'], m(0))).toEqual([])
  })

  it('throws on an unknown station or a bad option', () => {
    expect(() => route(tt, ['nope'], ['101'], m(0))).toThrow(/unknown station/)
    expect(() => route(tt, ['101'], ['nope'], m(0))).toThrow(/unknown station/)
    expect(() => route(tt, ['101'], ['103'], m(0), { maxTransfers: -1 })).toThrow(/maxTransfers/)
    expect(() => route(tt, ['101'], ['103'], Number.NaN)).toThrow(/departure time/)
    expect(() => route(tt, ['101'], ['103'], 2 ** 30)).toThrow(/departure time/)
    expect(() => route(tt, ['101'], ['103'], -(2 ** 30))).toThrow(/departure time/)
  })

  it('stops at maxTransfers', () => {
    expect(summary(route(tt, ['101'], ['S01'], m(0), { maxTransfers: 1 }))).toEqual([{ arriveS: m(34.5), transfers: 1 }])
    expect(route(tt, ['101'], ['S01'], m(0), { maxTransfers: 0 })).toEqual([])
    expect(walks(route(tt, ['101'], ['104'], m(0), { maxTransfers: 0 })[0]!)).toEqual([])
  })
})

describe('route on a minimal timetable', () => {
  // Stops of A, B and C; one trip A to B or A to C, and an optional walk between A and C.
  function tiny(stops: [string, string], arr: number[], dep: number[], walkAC?: number) {
    const index = buildStopIndex({
      stopIds: ['AN', 'AS', 'BN', 'BS', 'CN', 'CS'],
      changeS: new Map(),
      transfers: walkAC === undefined ? [] : [
        { from: 'A', to: 'C', minTransferSec: walkAC },
        { from: 'C', to: 'A', minTransferSec: walkAC },
      ],
    })
    return buildTimetable(index, makePatterns(index, { key: 'p', stops, trips: [{ id: 't', routeId: 'X', arr, dep }] }))
  }

  it('gives no journey to a station nothing reaches, at negative times', () => {
    // the arrival at B is negative: t + "no egress" must not look like a real arrival
    expect(route(tiny(['AN', 'BN'], [-500, -400], [-500, -400]), ['A'], ['C'], -600)).toEqual([])
  })

  it('drops a walk that a ride beats on arrival with the same transfers', () => {
    const table = tiny(['AN', 'CN'], [0, 120], [0, 120], 300)
    const js = route(table, ['A'], ['C'], 0)
    expect(js).toHaveLength(1)
    expect(js[0]).toMatchObject({ arriveS: 120, transfers: 0 })
    expect(js[0]!.legs.map((l) => l.kind)).toEqual(['ride'])
    // a walk alone is the answer when no train runs
    expect(route(table, ['A'], ['C'], 1)[0]).toMatchObject({ arriveS: 301, transfers: 0, legs: [{ kind: 'walk' }] })
  })
})
