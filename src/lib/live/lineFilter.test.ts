import { describe, expect, it } from 'vitest'
import type { ArrivalGroup } from './arrivals'
import {
  arrivalLines,
  filterArrivals,
  lineFilterAnnouncement,
  lineKey,
  lineOf,
  NO_FILTER,
  resolveLine,
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

describe('arrivalLines', () => {
  const order = ['A', 'C', 'F', 'FX', '6', '6X']

  it('lists the lines with arrivals in route order, one chip for a line and its express', () => {
    const groups = [group('6X'), group('F'), group('FX'), group('A'), group('6')]
    expect(arrivalLines(order, groups).map((c) => c.key)).toEqual(['A', 'F', '6'])
    expect(arrivalLines(order, groups).find((c) => c.key === 'F')).toEqual({ key: 'F', routeId: 'F', routeIds: ['F', 'FX'] })
  })

  it('draws the express variant when it is the only one running', () => {
    const [, six] = arrivalLines(order, [group('A'), group('6X')])
    expect(six).toEqual({ key: '6', routeId: '6X', routeIds: ['6X'] })
  })

  it('drops a line without arrivals, and offers nothing for under two lines', () => {
    expect(arrivalLines(order, [group('A'), group('C')]).map((c) => c.key)).toEqual(['A', 'C'])
    expect(arrivalLines(order, [group('A'), group('A', 'Y')])).toEqual([])
    expect(arrivalLines(order, [group('F'), group('FX')])).toEqual([])
    expect(arrivalLines(order, [])).toEqual([])
  })

  it('puts a route the station does not list last', () => {
    expect(arrivalLines(['A', 'C'], [group('Q'), group('C'), group('A')]).map((c) => c.key)).toEqual(['A', 'C', 'Q'])
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

describe('resolveLine', () => {
  const choices = arrivalLines(['A', 'C'], [group('A'), group('C')])

  it('keeps a line that has a chip and falls back to every line when it has none', () => {
    expect(resolveLine('A', choices)).toBe('A')
    expect(resolveLine('E', choices)).toBeNull()
    expect(resolveLine('A', [])).toBeNull()
    expect(resolveLine(null, choices)).toBeNull()
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
  it('names the line or all trains', () => {
    expect(lineFilterAnnouncement('A')).toBe('Showing A trains')
    expect(lineFilterAnnouncement(null)).toBe('Showing all trains')
  })
})
