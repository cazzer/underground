import { describe, expect, it } from 'vitest'
import { deckSpanSets, maskWeightIn, spanSet, trainWeightIn, type PlatformSpan, type StationSpans } from './platformSpan'

const span = (d0: number, d1: number, stopId?: string): PlatformSpan => (stopId ? { d0, d1, stopId } : { d0, d1 })

describe('spanSet', () => {
  it('is null for no interiors and for interiors without spans', () => {
    expect(spanSet([])).toBeNull()
    expect(spanSet([null, null])).toBeNull()
  })

  it('keeps one interior’s span objects', () => {
    const s = span(0, 150)
    const set = spanSet([new Map([['L..N', s]])])!
    expect(set.get('L..N')).toEqual([s])
    expect(set.get('L..N')![0]).toBe(s)
  })

  it('gives two stations on one shape two entries, never one span across the track between them', () => {
    const a: StationSpans = new Map([['L..N', span(0, 150)]])
    const b: StationSpans = new Map([['L..N', span(900, 1050)], ['G..N', span(10, 90)]])
    const before = [...a.values(), ...b.values()].map((s) => ({ ...s }))
    const set = spanSet([a, null, b])!
    const list = set.get('L..N')!
    expect(list).toHaveLength(2)
    expect(set.get('G..N')).toHaveLength(1)
    for (const at of [75, 975]) {
      expect(maskWeightIn(at, list)).toBe(1)
      expect(trainWeightIn(at, list)).toBe(1)
    }
    expect(maskWeightIn(500, list)).toBe(0)
    expect(trainWeightIn(500, list)).toBe(0)
    // The inputs are shared, not changed.
    expect([...a.values(), ...b.values()]).toEqual(before)
    expect(a.size).toBe(1)
  })
})

describe('deckSpanSets', () => {
  it('is one set for one single-deck interior, and [null] for none', () => {
    const a: StationSpans = new Map([['L..N', span(0, 150)]])
    const sets = deckSpanSets([[a]])
    expect(sets).toHaveLength(1)
    expect(sets[0]!.get('L..N')).toHaveLength(1)
    expect(deckSpanSets([])).toEqual([null])
    expect(deckSpanSets([[null]])).toEqual([null])
  })

  it("puts deck k of every interior in set k, as long as the most decks any has", () => {
    const lone: StationSpans = new Map([['L..N', span(0, 150)]])
    const deep: StationSpans = new Map([['L..N', span(2000, 2150, 'L03N')]])
    const upper: StationSpans = new Map([['4..N', span(500, 650, '635N')]])
    const sets = deckSpanSets([[lone], [deep, upper]])
    expect(sets).toHaveLength(2)
    expect(sets[0]!.get('L..N')!.map((s) => s.d0)).toEqual([0, 2000])
    expect([...sets[1]!.keys()]).toEqual(['4..N'])
  })

  it('skips an interior with no spans on a deck', () => {
    const upper: StationSpans = new Map([['4..N', span(500, 650)]])
    const sets = deckSpanSets([[null, upper], [null]])
    expect(sets[0]).toBeNull()
    expect(sets[1]!.get('4..N')).toHaveLength(1)
  })
})

describe('weights over a list', () => {
  it('is the highest of each span’s weight, 0 for no spans', () => {
    const list = [span(0, 100), span(130, 230)]
    expect(maskWeightIn(50, [])).toBe(0)
    expect(trainWeightIn(50, [])).toBe(0)
    // 115 is 15 m past the first span and 15 m before the second: both ramps reach it, the larger wins.
    expect(trainWeightIn(115, list)).toBeGreaterThan(0)
    expect(trainWeightIn(115, list)).toBe(trainWeightIn(115, [list[0]!]))
  })
})
