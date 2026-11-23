import { describe, expect, it } from 'vitest'
import { deckSpanSets, maskWeightIn, spanSet, trainWeightIn, type PlatformSpan, type ShownSpan, type StationSpans } from './platformSpan'

const span = (d0: number, d1: number, stopId?: string): PlatformSpan => (stopId ? { d0, d1, stopId } : { d0, d1 })
const FULL = { value: 1 }
const one = (spans: StationSpans | null, presence = FULL) => ({ spans, presence })
const decks = (d: (StationSpans | null)[], presence = FULL) => ({ decks: d, presence })

describe('spanSet', () => {
  it('is null for no interiors and for interiors without spans', () => {
    expect(spanSet([])).toBeNull()
    expect(spanSet([one(null), one(null)])).toBeNull()
  })

  it("keeps one interior's span objects with its presence", () => {
    const s = span(0, 150)
    const p = { value: 0.5 }
    const list = spanSet([one(new Map([['L..N', s]]), p)])!.get('L..N')!
    expect(list).toHaveLength(1)
    expect(list[0]!.span).toBe(s)
    expect(list[0]!.presence).toBe(p)
  })

  it('gives two stations on one shape two entries, never one span across the track between them', () => {
    const a: StationSpans = new Map([['L..N', span(0, 150)]])
    const b: StationSpans = new Map([['L..N', span(900, 1050)], ['G..N', span(10, 90)]])
    const before = [...a.values(), ...b.values()].map((s) => ({ ...s }))
    const set = spanSet([one(a), one(null), one(b)])!
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
    const sets = deckSpanSets([decks([a])])
    expect(sets).toHaveLength(1)
    expect(sets[0]!.get('L..N')).toHaveLength(1)
    expect(deckSpanSets([])).toEqual([null])
    expect(deckSpanSets([decks([null])])).toEqual([null])
  })

  it('puts deck k of every interior in set k, as long as the most decks any has', () => {
    const lone: StationSpans = new Map([['L..N', span(0, 150)]])
    const deep: StationSpans = new Map([['L..N', span(2000, 2150, 'L03N')]])
    const upper: StationSpans = new Map([['4..N', span(500, 650, '635N')]])
    const sets = deckSpanSets([decks([lone]), decks([deep, upper])])
    expect(sets).toHaveLength(2)
    expect(sets[0]!.get('L..N')!.map((s) => s.span.d0)).toEqual([0, 2000])
    expect([...sets[1]!.keys()]).toEqual(['4..N'])
  })

  it('skips an interior with no spans on a deck', () => {
    const upper: StationSpans = new Map([['4..N', span(500, 650)]])
    const sets = deckSpanSets([decks([null, upper]), decks([null])])
    expect(sets[0]).toBeNull()
    expect(sets[1]!.get('4..N')).toHaveLength(1)
  })
})

describe('weights over a list', () => {
  it("is the highest of each span's weight, 0 for no spans", () => {
    const list: ShownSpan[] = [
      { span: span(0, 100), presence: FULL },
      { span: span(130, 230), presence: FULL },
    ]
    expect(maskWeightIn(50, [])).toBe(0)
    expect(trainWeightIn(50, [])).toBe(0)
    // 115 is 15 m past the first span and 15 m before the second: both ramps reach it, the larger wins.
    expect(trainWeightIn(115, list)).toBeGreaterThan(0)
    expect(trainWeightIn(115, list)).toBe(trainWeightIn(115, [list[0]!]))
  })

  it("scales a train's lift and the track's fade by its interior's presence", () => {
    const fading: ShownSpan[] = [{ span: span(0, 100), presence: { value: 0.25 } }]
    expect(trainWeightIn(50, fading)).toBe(0.25)
    expect(maskWeightIn(50, fading)).toBe(0.25)
    // Two interiors on one shape: each weight is its own presence's.
    const two: ShownSpan[] = [...fading, { span: span(900, 1000), presence: FULL }]
    expect(maskWeightIn(50, two)).toBe(0.25)
    expect(maskWeightIn(950, two)).toBe(1)
  })
})
