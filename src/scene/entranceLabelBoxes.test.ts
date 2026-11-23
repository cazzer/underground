import { describe, expect, it } from 'vitest'
import type { PerspectiveCamera } from 'three'
import type { EntranceLabelSource } from '../data/useStationStreets'
import { rankEntrances } from './entranceLabelBoxes'
import { labelLayer } from './labelFixture'
import { createLabelPlacement } from './labelPlacementLayout'
import { newView, type LabelPlacement } from './labelPlacementState'

function entrance(index: number, over: Partial<EntranceLabelSource> = {}): EntranceLabelSource {
  return { index, x: index * 10, z: 0, head: `E${index}`, tail: '', text: `E${index}`, spoken: `E${index}`, count: 1, members: [index], elevator: false, unique: true, keys: [], headHouse: index, streets: [], ...over }
}

/** Ranks station `s` of `p` with each of its marks `distance[k]` px from the free area's middle. */
function rank(p: LabelPlacement, s: number, distance: number[], priorityEntrance = -1, focusedFirst = true): number[] {
  const view = newView(null as unknown as PerspectiveCamera, 1.25)
  view.priorityEntrance = priorityEntrance
  view.focusedFirst = focusedFirst
  const first = p.segItem0[s]!
  const end = p.segStreet0[s]!
  for (let i = first; i < end; i++) {
    p.cand.size[i] = 6
    p.markX[i] = distance[i - first]!
    p.markY[i] = 0
  }
  rankEntrances(p, view, s)
  return Array.from(p.cand.order.subarray(first, end)).map((i) => i - first)
}

/** The rank order of `entrances` as the focused (first) station. */
function order(entrances: EntranceLabelSource[], distance: number[], priorityEntrance = -1): number[] {
  return rank(createLabelPlacement([{ layer: labelLayer('A', entrances), bundles: [] }], []), 0, distance, priorityEntrance)
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

  it('ranks a second station within its own range, head houses by its own indexes, and never as the exit', () => {
    const a = [entrance(0), entrance(1), entrance(2)]
    // B's E0 and E1 share head house 0; E1 stands for street-file entrance 1, the focused station's exit index.
    const b = [entrance(0, { headHouse: 0 }), entrance(1, { headHouse: 0 }), entrance(2, { headHouse: 1 })]
    const p = createLabelPlacement(
      [
        { layer: labelLayer('A', a), bundles: [] },
        { layer: labelLayer('B', b), bundles: [] },
      ],
      [],
    )
    rank(p, 0, [5, 6, 7])
    const before = Array.from(p.cand.order.subarray(0, 3))
    p.score.fill(-1, 0, 3)
    // House 0's second (E1, nearer than E2 but its house's second) ranks after house 1's best.
    expect(rank(p, 1, [10, 20, 30], 1)).toEqual([0, 2, 1])
    // Station A's order positions and scratch are untouched.
    expect(Array.from(p.cand.order.subarray(0, 3))).toEqual(before)
    expect(Array.from(p.score.subarray(0, 3))).toEqual([-1, -1, -1])
  })
})
