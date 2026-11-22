import { describe, expect, it } from 'vitest'
import type { ArrivalGroup } from './arrivals'
import {
  filterArrivals,
  lineFilterAnnouncement,
  lineKey,
  lineOf,
  linesDue,
  NO_FILTER,
  stationLines,
  toggledFilter,
} from './lineFilter'

const group = (routeId: string, headsign = 'X'): ArrivalGroup => ({
  routeId,
  direction: 'N',
  headsign,
  times: [100],
  tripKeys: [`k:${routeId}${headsign}`],
})

describe('lineKey', () => {
  it('folds express variants into their line', () => {
    expect(lineKey('6X')).toBe('6')
    expect(lineKey('FX')).toBe('F')
    expect(lineKey('7X')).toBe('7')
  })

  it('keeps every other route, the shuttles apart', () => {
    for (const id of ['6', 'F', 'GS', 'FS', 'H', 'SI', 'X']) expect(lineKey(id)).toBe(id)
  })
})

describe('stationLines', () => {
  const order = ['A', 'C', 'F', 'FX', '6', '6X']

  it("lists the station's lines in route order, one chip for a line and its express", () => {
    expect(stationLines(order).map((c) => c.key)).toEqual(['A', 'C', 'F', '6'])
    expect(stationLines(order).find((c) => c.key === 'F')).toEqual({ key: 'F', routeId: 'F', routeIds: ['F', 'FX'] })
  })

  it('draws the express variant when the station has only that', () => {
    expect(stationLines(['A', '6X'])[1]).toEqual({ key: '6', routeId: '6X', routeIds: ['6X'] })
  })

  it('offers nothing for under two lines', () => {
    expect(stationLines(['A'])).toEqual([])
    expect(stationLines(['F', 'FX'])).toEqual([])
    expect(stationLines([])).toEqual([])
  })
})

describe('linesDue', () => {
  it('names the lines with a group, an express under its line', () => {
    expect([...linesDue([group('6X'), group('A'), group('6')])].sort()).toEqual(['6', 'A'])
    expect(linesDue([]).size).toBe(0)
  })
})

describe('toggledFilter', () => {
  it('chooses a line, switches to another, and clears on the same one', () => {
    const a = toggledFilter(NO_FILTER, '635', 'A')
    expect(lineOf(a, '635')).toBe('A')
    const c = toggledFilter(a, '635', 'C')
    expect(lineOf(c, '635')).toBe('C')
    expect(lineOf(toggledFilter(c, '635', 'C'), '635')).toBeNull()
  })

  it('reads as no filter at any other station or with no station', () => {
    const a = toggledFilter(NO_FILTER, '635', 'A')
    expect(lineOf(a, 'L08')).toBeNull()
    expect(lineOf(a, null)).toBeNull()
    expect(lineOf(toggledFilter(a, 'L08', 'A'), 'L08')).toBe('A')
  })
})

describe('a chosen line that goes quiet', () => {
  it('stays chosen (only a toggle or another station ends it) and filters to nothing', () => {
    const state = toggledFilter(NO_FILTER, '635', 'A')
    const quiet = [group('C'), group('6')]
    expect(lineOf(state, '635')).toBe('A')
    expect(filterArrivals(quiet, lineOf(state, '635'))).toEqual([])
    expect(linesDue(quiet).has('A')).toBe(false)
  })
})

describe('filterArrivals', () => {
  const groups = [group('A', '1'), group('6', '2'), group('6X', '3'), group('A', '4')]

  it('keeps one line, express included, in order', () => {
    expect(filterArrivals(groups, '6').map((g) => g.headsign)).toEqual(['2', '3'])
    expect(filterArrivals(groups, 'A').map((g) => g.headsign)).toEqual(['1', '4'])
  })

  it('returns every group, as a copy, for no line', () => {
    const all = filterArrivals(groups, null)
    expect(all).toEqual(groups)
    expect(all).not.toBe(groups)
  })
})

describe('lineFilterAnnouncement', () => {
  it('names the line with its destinations, or all trains', () => {
    expect(lineFilterAnnouncement('A', 3)).toBe('Showing A trains, 3 destinations')
    expect(lineFilterAnnouncement('A', 1)).toBe('Showing A trains, 1 destination')
    expect(lineFilterAnnouncement('A', 0)).toBe('Showing A trains, none due')
    expect(lineFilterAnnouncement(null, 7)).toBe('Showing all trains')
  })
})
