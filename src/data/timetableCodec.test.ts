import { describe, expect, it } from 'vitest'
import { decodePatternTimes } from './timetableCodec.ts'
import type { TimetablePattern } from './timetableSchema.ts'

const pattern = (stops: string[], trips: TimetablePattern['trips']): TimetablePattern => ({ routeId: '1', direction: 'S', stops, trips })

describe('decodePatternTimes', () => {
  it('turns units into seconds, accumulating the first-departure deltas', () => {
    const times = decodePatternTimes(pattern(['101S', '103S', '104S'], [[10, [2, 3]], [4, [2, 3]], [0, [3, 3]]]))
    expect(times.map((t) => t.departures[0])).toEqual([300, 420, 420])
    expect(times[0]).toEqual({ arrivals: [300, 360, 450], departures: [300, 360, 450] })
    expect(times[2]!.arrivals).toEqual([420, 510, 600])
  })

  it('puts the arrival before the departure for a dwell at index 0 and after the departure for the last index', () => {
    const times = decodePatternTimes(pattern(['101S', '103S', '104S'], [[10, [2, 3], [0, 1, 2, 2]]]))
    expect(times[0]).toEqual({ arrivals: [270, 360, 450], departures: [300, 360, 510] })
  })

  it('throws on a runs length that does not fit the stops', () => {
    expect(() => decodePatternTimes(pattern(['101S', '103S', '104S'], [[10, [2]]]))).toThrow(/1 runs for 3 stops/)
  })

  it('throws on an odd dwell, an index out of range, and indexes not ascending', () => {
    const stops = ['101S', '103S', '104S']
    expect(() => decodePatternTimes(pattern(stops, [[10, [2, 3], [1]]]))).toThrow(/odd dwell/)
    expect(() => decodePatternTimes(pattern(stops, [[10, [2, 3], [3, 1]]]))).toThrow(/bad dwell index 3/)
    expect(() => decodePatternTimes(pattern(stops, [[10, [2, 3], [1, 1, 1, 1]]]))).toThrow(/bad dwell index 1/)
    expect(() => decodePatternTimes(pattern(stops, [[10, [2, 3], [2, 1, 1, 1]]]))).toThrow(/bad dwell index 1/)
  })
})
