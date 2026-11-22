import { describe, expect, it } from 'vitest'
import type { PerspectiveCamera } from 'three'
import type { EntranceLabelSource } from '../data/useStationStreets'
import { rankEntrances } from './entranceLabelBoxes'
import { createLabelPlacement, newView } from './labelPlacementState'

function entrance(index: number, over: Partial<EntranceLabelSource> = {}): EntranceLabelSource {
  return { index, x: index * 10, z: 0, head: `E${index}`, tail: '', text: `E${index}`, spoken: `E${index}`, count: 1, members: [index], elevator: false, unique: true, keys: [], headHouse: index, streets: [], ...over }
}

/** The rank order of `entrances` with each mark `distance[i]` px from the free area's middle. */
function order(entrances: EntranceLabelSource[], distance: number[], priorityEntrance = -1): number[] {
  const p = createLabelPlacement(entrances, [], [], [], [])
  const view = newView(null as unknown as PerspectiveCamera, 1.25)
  view.priorityEntrance = priorityEntrance
  entrances.forEach((_, i) => {
    p.cand.size[i] = 6
    p.markX[i] = distance[i]!
    p.markY[i] = 0
  })
  rankEntrances(p, view)
  return Array.from(p.cand.order.subarray(0, entrances.length))
}

describe('rankEntrances', () => {
  // E0 an elevator far out, E1 unique and nearest, E2 sharing its text with another, E3 its twin.
  const entrances = [entrance(0, { elevator: true }), entrance(1), entrance(2, { unique: false }), entrance(3, { unique: false })]
  const distance = [400, 10, 20, 30]

  it('puts elevators first, then unique labels, then the rest, nearest first within a tier', () => {
    expect(order(entrances, distance)).toEqual([0, 1, 2, 3])
  })

  it('puts the trip exit’s label (by street-file entrance index) before every other, elevators included', () => {
    expect(order(entrances, distance, 3)).toEqual([3, 0, 1, 2])
    // Keyed by EntranceText.index, not the label's row.
    const rows = [entrance(5), entrance(7, { elevator: true })]
    expect(order(rows, [10, 50], 5)).toEqual([0, 1])
    expect(order(rows, [10, 50], 1)).toEqual([1, 0])
  })

  it('finds the exit among a label’s merged twins (its members)', () => {
    const rows = [entrance(2, { elevator: true }), entrance(5, { members: [5, 6], count: 2 })]
    expect(order(rows, [10, 50], 6)).toEqual([1, 0])
  })
})
