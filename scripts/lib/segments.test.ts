import { describe, expect, it } from 'vitest'
import { fixtureFeed } from './fixture.ts'
import type { StopTimeRow } from './gtfs.ts'
import { buildSegments, median } from './segments.ts'

const row = (tripId: string, stopId: string, arrival: number, departure: number, sequence: number): StopTimeRow => ({
  tripId,
  stopId,
  arrival,
  departure,
  sequence,
})

describe('median', () => {
  it('takes the middle of an odd count and the mean of an even count', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([7])).toBe(7)
  })
  it('throws on no values', () => {
    expect(() => median([])).toThrow()
  })
})

describe('buildSegments', () => {
  const { segments, skipped } = buildSegments(fixtureFeed().stopTimes)

  it('keys are sorted and no pair crosses a trip boundary', () => {
    expect(Object.keys(segments)).toEqual([
      'A01S>A02S',
      'A01S>A03S',
      'A02S>A03S',
      'B01S>B02S',
      'B01S>B03S',
      'B02S>B03S',
      'G01N>A02N',
    ])
  })
  it('takes the median across trips', () => {
    expect(segments['A01S>A02S']).toBe(80)
  })
  it('excludes dwell from run time', () => {
    expect(segments['A01S>A03S']).toBe(200)
  })
  it('handles times past midnight', () => {
    expect(segments['B01S>B02S']).toBe(210)
  })
  it('skips and counts samples of zero seconds or less', () => {
    expect(skipped).toBe(1)
  })
  it('follows stop_sequence even when rows are shuffled', () => {
    const rows = [row('t', 'C', 300, 300, 3), row('t', 'A', 0, 10, 1), row('t', 'B', 100, 120, 2)]
    expect(buildSegments(rows).segments).toEqual({ 'A>B': 90, 'B>C': 180 })
  })
  it('rounds an even-count median to whole seconds', () => {
    const rows = [row('a', 'A', 0, 0, 1), row('a', 'B', 60, 60, 2), row('b', 'A', 0, 0, 1), row('b', 'B', 61, 61, 2)]
    expect(buildSegments(rows).segments['A>B']).toBe(61)
  })
})
