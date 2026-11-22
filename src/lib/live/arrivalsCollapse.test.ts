import { describe, expect, it } from 'vitest'
import type { ArrivalGroup } from './arrivals'
import { arrivalGroupCount, arrivalGroupKey, COLLAPSED_ARRIVALS, soonestSections } from './arrivalsCollapse'

const group = (routeId: string, direction: 'N' | 'S', headsign: string, first: number): ArrivalGroup => ({
  routeId,
  direction,
  headsign,
  times: [first, first + 600],
  tripKeys: [`${routeId}:${first}`, `${routeId}:${first + 600}`],
})

// Times Sq, as the station panel orders its groups: by direction, then by first time.
const north = [group('3', 'N', 'Harlem-148 St', 180), group('2', 'N', 'Wakefield-241 St', 300), group('1', 'N', 'Van Cortlandt Park-242 St', 1020)]
const south = [group('1', 'S', 'South Ferry', 480), group('3', 'S', '34 St-Penn Station', 780), group('2', 'S', 'Flatbush Av', 1080)]
const names = (sections: ArrivalGroup[][]) => sections.map((s) => s.map((g) => g.headsign))

describe('soonestSections', () => {
  it('keeps the three groups due soonest across both directions, each in its own section and place', () => {
    const out = soonestSections([north, south], COLLAPSED_ARRIVALS)
    expect(names(out)).toEqual([['Harlem-148 St', 'Wakefield-241 St'], ['South Ferry']])
    expect(arrivalGroupCount(out)).toBe(3)
  })

  it('drops a direction none of whose groups is among the soonest', () => {
    const out = soonestSections([north, [group('1', 'S', 'South Ferry', 5000)]], COLLAPSED_ARRIVALS)
    expect(names(out)).toEqual([['Harlem-148 St', 'Wakefield-241 St', 'Van Cortlandt Park-242 St']])
  })

  it('keeps list order on a tie, and every group when there are no more than the limit', () => {
    const tie = [group('A', 'N', 'a', 100), group('B', 'N', 'b', 100), group('C', 'N', 'c', 100), group('D', 'N', 'd', 100)]
    expect(soonestSections([tie], 3)[0]!.map((g) => g.headsign)).toEqual(['a', 'b', 'c'])
    expect(soonestSections([north.slice(0, 2), south.slice(0, 1)], 3)).toEqual([north.slice(0, 2), south.slice(0, 1)])
  })

  it('keeps the focused group in place of the latest of the soonest', () => {
    const out = soonestSections([north, south], COLLAPSED_ARRIVALS, arrivalGroupKey(south[2]!))
    expect(names(out)).toEqual([['Harlem-148 St', 'Wakefield-241 St'], ['Flatbush Av']])
    // Already among the soonest, or gone from the list: nothing changes.
    expect(soonestSections([north, south], 3, arrivalGroupKey(north[0]!))).toEqual(soonestSections([north, south], 3))
    expect(soonestSections([north, south], 3, '7|Flushing-Main St')).toEqual(soonestSections([north, south], 3))
  })

  it("keeps a focused row from one poll to the next as its train leaves and the next one is later than others'", () => {
    // Poll 1: the 3 to Harlem is due now and has focus.
    const harlem = arrivalGroupKey(north[0]!)
    expect(names(soonestSections([north, south], 3, harlem))).toEqual([['Harlem-148 St', 'Wakefield-241 St'], ['South Ferry']])
    // Poll 2, 4 min on: that train left, so the 3 to Harlem's next one is 10 min out, behind three others.
    const north2 = [group('2', 'N', 'Wakefield-241 St', 300), group('1', 'N', 'Van Cortlandt Park-242 St', 420), group('3', 'N', 'Harlem-148 St', 780)]
    const south2 = [group('1', 'S', 'South Ferry', 480), group('3', 'S', '34 St-Penn Station', 780), group('2', 'S', 'Flatbush Av', 1080)]
    expect(names(soonestSections([north2, south2], 3))).toEqual([['Wakefield-241 St', 'Van Cortlandt Park-242 St'], ['South Ferry']])
    expect(names(soonestSections([north2, south2], 3, harlem))).toEqual([['Wakefield-241 St', 'Van Cortlandt Park-242 St', 'Harlem-148 St']])
  })

  it('counts every group', () => {
    expect(arrivalGroupCount([north, south])).toBe(6)
    expect(arrivalGroupCount([])).toBe(0)
  })
})
