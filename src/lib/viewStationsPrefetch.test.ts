import { describe, expect, it } from 'vitest'
import { chooseViewStations, gateZone, GATE_KEEP_FACTOR, MAX_PREFETCH_STATIONS, MAX_VIEW_STATIONS, newViewScratch, PREFETCH_FAR, viewZones, type ViewQuery, type ViewStationSpace } from './viewStations'
import { REVEAL_FAR } from './interiorReveal'
import { lone, queryAt, spaceOf } from './viewStationsFixture'

/** Nine stations on a line, 40 m apart from the target, ids S0..S8 (S0 nearest). */
const nine = (): ViewStationSpace => spaceOf(Array.from({ length: 9 }, (_, i) => lone(`S${i}`, 40 * (i + 1) - 400, 0)))

function choose(sp: ViewStationSpace, q: ViewQuery, scratch = newViewScratch(sp, MAX_PREFETCH_STATIONS)): string[] {
  const out = new Int32Array(MAX_PREFETCH_STATIONS)
  const n = chooseViewStations(sp, q, scratch, out)
  return Array.from(out.subarray(0, n), (i) => sp.ids[i]!)
}

const wide = (distance: number, over: Partial<ViewQuery> = {}): ViewQuery =>
  queryAt(distance, { far: PREFETCH_FAR, max: MAX_PREFETCH_STATIONS, ...over }, MAX_PREFETCH_STATIONS)

describe('prefetch choice', () => {
  it('qualifies out to PREFETCH_FAR and not at it', () => {
    const sp = spaceOf([lone('A', 100, 0)])
    expect(PREFETCH_FAR).toBe(2 * REVEAL_FAR)
    expect(choose(sp, wide(2000))).toEqual(['A'])
    expect(choose(sp, wide(PREFETCH_FAR - 1))).toEqual(['A'])
    expect(choose(sp, wide(PREFETCH_FAR))).toEqual([])
  })

  it('leaves the default choice empty at 2000 m', () => {
    const sp = spaceOf([lone('A', 100, 0)])
    expect(choose(sp, queryAt(2000))).toEqual([])
  })

  it('keeps the six nearest of nine, ties by lower index', () => {
    const sp = spaceOf(Array.from({ length: 9 }, (_, i) => lone(`T${i}`, i % 2 === 0 ? 50 : -50, 0)))
    expect(choose(sp, wide(1100))).toEqual(['T0', 'T1', 'T2', 'T3', 'T4', 'T5'])
    expect(choose(nine(), wide(1100))).toHaveLength(MAX_PREFETCH_STATIONS)
  })

  it('with no focused head, its first four are the default choice at 1100 m', () => {
    const sp = nine()
    const prefetch = choose(sp, wide(1100))
    expect(choose(sp, queryAt(1100), newViewScratch(sp, MAX_PREFETCH_STATIONS))).toEqual(prefetch.slice(0, MAX_VIEW_STATIONS))
  })

  it('keeps a previous pick past PREFETCH_FAR out to its keep distance only', () => {
    const sp = spaceOf([lone('A', 100, 0), lone('B', 120, 0)])
    const previous = Int32Array.of(0)
    const kept = PREFETCH_FAR * GATE_KEEP_FACTOR
    expect(choose(sp, wide(PREFETCH_FAR + 10, { previous, previousCount: 1 }))).toEqual(['A'])
    expect(choose(sp, wide(kept - 1, { previous, previousCount: 1 }))).toEqual(['A'])
    expect(choose(sp, wide(kept + 1, { previous, previousCount: 1 }))).toEqual([])
  })

  it('shares a scratch with the default choice: same answers in either order, left clean', () => {
    const sp = nine()
    const scratch = newViewScratch(sp, MAX_PREFETCH_STATIONS)
    const first = choose(sp, queryAt(1100), scratch)
    const second = choose(sp, wide(1100), scratch)
    const again = choose(sp, queryAt(1100), scratch)
    expect(again).toEqual(first)
    expect(second).toHaveLength(MAX_PREFETCH_STATIONS)
    expect(Array.from(scratch.was).every((v) => v === 0)).toBe(true)
  })
})

describe('gate zones', () => {
  it('gateZone takes a gate and changes at it and its keep distance', () => {
    expect(gateZone(PREFETCH_FAR - 1, PREFETCH_FAR)).toBe(0)
    expect(gateZone(PREFETCH_FAR, PREFETCH_FAR)).toBe(1)
    expect(gateZone(PREFETCH_FAR * GATE_KEEP_FACTOR, PREFETCH_FAR)).toBe(2)
    expect(gateZone(REVEAL_FAR)).toBe(1)
  })

  it('viewZones changes exactly at both gates and both keep distances, and nowhere else', () => {
    const changes: number[] = []
    let last = viewZones(300)
    for (let d = 301; d <= 3000; d++) {
      const z = viewZones(d)
      if (z !== last) changes.push(d)
      last = z
    }
    const edge = (x: number): number => Math.ceil(x)
    expect(changes).toEqual([REVEAL_FAR, REVEAL_FAR * GATE_KEEP_FACTOR, PREFETCH_FAR, PREFETCH_FAR * GATE_KEEP_FACTOR].map(edge))
  })
})
