import { describe, expect, it } from 'vitest'
import { buildTimetable, makePatterns, type PatternInput, type TripInput } from './patterns'
import { route } from './raptor'
import { buildStopIndex } from './stops'

const index = buildStopIndex({ stopIds: ['101N', '102N', '103N', '101S'], changeS: new Map(), transfers: [] })

const trip = (id: string, arr: number[], dep: number[] = arr): TripInput => ({ id, routeId: 'X', arr, dep })
const pattern = (trips: TripInput[], stops = ['101N', '102N']): PatternInput => ({ key: 'p', stops, trips })

describe('makePatterns', () => {
  it('splits a trip that overtakes the one before it into its own pattern', () => {
    const slow = trip('slow', [0, 1200])
    const fast = trip('fast', [60, 600])
    const pats = makePatterns(index, pattern([fast, slow]))
    expect(pats.map((p) => p.key)).toEqual(['p', 'p#1'])
    expect(pats.map((p) => p.tripIds)).toEqual([['slow'], ['fast']])

    const [journey] = route(buildTimetable(index, pats), ['101'], ['102'], 0)
    expect(journey?.arriveS).toBe(600)
    expect(journey?.legs[0]).toMatchObject({ kind: 'ride', tripId: 'fast', patternKey: 'p#1' })
  })

  it('keeps trips that never overtake in one pattern, sorted by first departure', () => {
    const [only, ...rest] = makePatterns(index, pattern([trip('b', [100, 700]), trip('a', [0, 600]), trip('c', [100, 800])]))
    expect(rest).toEqual([])
    expect(only?.tripIds).toEqual(['a', 'b', 'c'])
    expect([...only!.dep]).toEqual([0, 600, 100, 700, 100, 800])
  })

  it('makes no pattern for no trips', () => {
    expect(makePatterns(index, pattern([]))).toEqual([])
  })

  it('throws on malformed input', () => {
    expect(() => makePatterns(index, pattern([trip('t', [0, 60, 120])]))).toThrow(/2 times/)
    expect(() => makePatterns(index, pattern([trip('t', [0, 100], [0, 100]), trip('u', [10], [10])]))).toThrow(/2 times/)
    expect(() => makePatterns(index, pattern([trip('t', [100, 200], [50, 200])]))).toThrow(/before it arrives/)
    expect(() => makePatterns(index, pattern([trip('t', [0, 50], [60, 50])]))).toThrow(/backward/)
    expect(() => makePatterns(index, pattern([trip('t', [0, 60.5])]))).toThrow(/non-integer/)
    expect(() => makePatterns(index, pattern([trip('t', [0, 60])], ['101N', '999N']))).toThrow(/unknown stop/)
    expect(() => makePatterns(index, pattern([trip('t', [0])], ['101N']))).toThrow(/at least 2 stops/)
  })
})

describe('buildTimetable', () => {
  it('lists every (pattern, position) a stop appears at, in pattern order', () => {
    const a = makePatterns(index, { key: 'a', stops: ['101N', '102N', '103N'], trips: [trip('t', [0, 60, 120])] })
    const b = makePatterns(index, { key: 'b', stops: ['102N', '103N', '102N'], trips: [trip('u', [0, 60, 120])] })
    const tt = buildTimetable(index, [...a, ...b])
    const p = index.stopOf.get('102N')!
    const entries = Array.from({ length: tt.patStart[p + 1]! - tt.patStart[p]! }, (_, i) => [
      tt.patAt[tt.patStart[p]! + i],
      tt.patPos[tt.patStart[p]! + i],
    ])
    expect(entries).toEqual([[0, 1], [1, 0], [1, 2]])
  })

  it('throws on a duplicate pattern key', () => {
    const a = makePatterns(index, pattern([trip('t', [0, 60])]))
    expect(() => buildTimetable(index, [...a, ...a])).toThrow(/duplicate pattern key/)
  })
})
