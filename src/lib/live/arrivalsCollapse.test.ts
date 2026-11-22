import { describe, expect, it } from 'vitest'
import type { ArrivalGroup } from './arrivals'
import { arrivalGroupCount, COLLAPSED_ARRIVALS, soonestSections } from './arrivalsCollapse'

const group = (routeId: string, direction: 'N' | 'S', headsign: string, first: number): ArrivalGroup => ({
  routeId,
  direction,
  headsign,
  times: [first, first + 600],
  tripKeys: [`${routeId}:${first}`, `${routeId}:${first + 600}`],
})

// Times Sq: three groups each way, as the station panel orders them (by direction, then as arrivalsAt lists them).
const north = [group('3', 'N', 'Harlem-148 St', 180), group('1', 'N', 'Van Cortlandt Park-242 St', 1020), group('2', 'N', 'Wakefield-241 St', 300)]
const south = [group('1', 'S', 'South Ferry', 480), group('3', 'S', '34 St-Penn Station', 780), group('2', 'S', 'Flatbush Av', 1080)]

describe('soonestSections', () => {
  it('keeps the three groups due soonest across both directions, each in its own section and place', () => {
    const out = soonestSections([north, south], COLLAPSED_ARRIVALS)
    expect(out.map((s) => s.map((g) => g.headsign))).toEqual([['Harlem-148 St', 'Wakefield-241 St'], ['South Ferry']])
    expect(arrivalGroupCount(out)).toBe(3)
  })

  it('drops a direction none of whose groups is among the soonest', () => {
    const out = soonestSections([north, [group('1', 'S', 'South Ferry', 5000)]], COLLAPSED_ARRIVALS)
    expect(out).toHaveLength(1)
    expect(out[0]!.map((g) => g.headsign)).toEqual(['Harlem-148 St', 'Van Cortlandt Park-242 St', 'Wakefield-241 St'])
  })

  it('keeps list order on a tie, and every group when there are no more than the limit', () => {
    const tie = [group('A', 'N', 'a', 100), group('B', 'N', 'b', 100), group('C', 'N', 'c', 100), group('D', 'N', 'd', 100)]
    expect(soonestSections([tie], 3)[0]!.map((g) => g.headsign)).toEqual(['a', 'b', 'c'])
    const out = soonestSections([north.slice(0, 2), south.slice(0, 1)], 3)
    expect(out).toEqual([north.slice(0, 2), south.slice(0, 1)])
  })

  it('counts every group', () => {
    expect(arrivalGroupCount([north, south])).toBe(6)
    expect(arrivalGroupCount([])).toBe(0)
  })
})
