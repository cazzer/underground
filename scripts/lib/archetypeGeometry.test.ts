/** Review round 1: platforms that are missing, unequal, split or curved, bad input, and what params carry. */
import { describe, expect, it } from 'vitest'
import { INTERIOR_MIN_CONFIDENCE, classifyStation } from './archetype.ts'
import * as fx from './archetypeFixtures.ts'
import type { StationFacts } from './stationFacts.ts'
import { toGround } from '../../src/lib/projection.ts'

const reasonsOf = (r: { reasons: string[] }): string => r.reasons.join('\n')
const MEZZ = [fx.equipmentFact('E', 'mezzanine to platform')]
const sub = (id: string, platforms: Parameters<typeof fx.buildStation>[3], tracks: number[], o: Parameters<typeof fx.buildStation>[5] = {}): StationFacts =>
  fx.buildStation(id, 'subway', 40, platforms, tracks, { levelTags: ['-2'], equipment: MEZZ, ...o })

describe('a platform that ends up in no layout costs 0.3 and is named', () => {
  it('a polygon covering its own trackbed', () => {
    const r = classifyStation(sub('A1', [[-10, 0], [3.5, 7.5]], [-1.85, 1.85]))
    expect(reasonsOf(r)).toMatch(/platform 1000 has a track drawn inside it at every cut and is left out of the layout: -0.3/)
    expect(r.confidence).toBeLessThan(INTERIOR_MIN_CONFIDENCE)
    expect(reasonsOf(r)).toMatch(/platform 1000 is missing from the layout; confidence capped at 0.6/)
  })

  it('a stub platform past the end of an island is sampled by its own cuts, not ignored', () => {
    const r = classifyStation(sub('A2', [[-3, 3], [8, 12, 80, 100]], [-4.7, 4.7]))
    expect(r.params!.platforms.map((l) => l.osmWays)).toEqual([[1000], [1001]])
  })
})

describe('track count does not depend on platform length or stagger', () => {
  const sides: [number, number][] = [[-7.5, -3.5], [3.5, 7.5]]
  it('a 150 m and a 40 m side platform, 2 tracks', () => {
    const r = classifyStation(sub('B1', [[sides[0]![0], sides[0]![1], -75, 75], [sides[1]![0], sides[1]![1], -20, 20]], [-1.85, 1.85]))
    expect(r.archetype).toBe('cut-cover-mezzanine')
    expect(r.params).toMatchObject({ platformType: 'side', trackCount: 2 })
  })

  it('staggered side platforms barely overlapping, 2 tracks', () => {
    const r = classifyStation(sub('B2', [[sides[0]![0], sides[0]![1], -75, 75], [sides[1]![0], sides[1]![1], 25, 175]], [-1.85, 1.85], { trackU: [-110, 210] }))
    expect(r.params).toMatchObject({ platformType: 'side', trackCount: 2 })
    expect(r.params!.platforms).toHaveLength(2)
  })

  it('Avenue H still reads 4 tracks, also with an 80 m platform opposite a 150 m one', () => {
    expect(classifyStation(fx.avenueH()).params!.trackCount).toBe(4)
    const r = classifyStation(sub('B3', [[-14, -9, -75, 75], [9, 14, -40, 40]], [-6.6, -2.9, 2.9, 6.6]))
    expect(r.params!.trackCount).toBe(4)
    expect(r.params!.trackOffsetsV.map((v) => Math.round(v * 10) / 10)).toEqual([-6.6, -2.9, 2.9, 6.6])
  })
})

describe('track count ignores platforms that are not in the layout', () => {
  it('a stray untracked polygon does not pull another line track into the count', () => {
    const r = classifyStation(sub('T1', [[-3, 3], [30, 34]], [-4.7, 4.7, 18]))
    expect(r.params!.trackCount).toBe(2)
    expect(r.params!.platforms.map((l) => l.osmWays)).toEqual([[1000]])
    expect(r.confidence).toBeLessThan(INTERIOR_MIN_CONFIDENCE)
  })
})

describe('curved platforms', () => {
  const R = 150
  const A = (60 * Math.PI) / 180
  const arc = (r: number, a: number, n = 30): [number, number][] =>
    Array.from({ length: n + 1 }, (_, k) => {
      const t = -a / 2 + (a * k) / n
      return [r * Math.sin(t), r * Math.cos(t) - R]
    })
  const curved = (): StationFacts => ({
    ...fx.buildStation('C1', 'subway', 40, [], [], { levelTags: ['-2'], equipment: MEZZ, entrances: [] }),
    platforms: [{ osmWay: 9, outline: [...arc(R - 3, A), ...arc(R + 3, A).reverse()], levelTag: '-2' }],
    tracks: [R - 4.7, R + 4.7].map((r, i) => ({ ref: `T${i}`, source: 'osm' as const, path: arc(r, A * 1.4, 40) })),
    entrances: [{ at: [0, -40], type: 'Stair' }, { at: [0, 40], type: 'Stair' }],
  })

  it('is penalized and capped at 0.5, with a reason', () => {
    const r = classifyStation(curved())
    expect(reasonsOf(r)).toMatch(/wander .* m across the station/)
    expect(reasonsOf(r)).toMatch(/platforms are curved .*capped at 0.5/)
    expect(r.confidence).toBeLessThanOrEqual(0.5)
  })

  it('reports track offsets and the platform center from the same cuts (they bracket it)', () => {
    const p = classifyStation(curved()).params!
    const [lo, hi] = [Math.min(...p.trackOffsetsV), Math.max(...p.trackOffsetsV)]
    expect(p.platforms[0]!.centerV).toBeGreaterThan(lo)
    expect(p.platforms[0]!.centerV).toBeLessThan(hi)
  })

  it('does not penalize a straight station', () => {
    expect(reasonsOf(classifyStation(fx.bedfordAv()))).not.toMatch(/wander/)
  })
})

describe('split platforms', () => {
  it('joins a island split end to end with a 3 m gap into one layout', () => {
    const r = classifyStation(sub('D1', [[-3, 3, -75, -1.5], [-3, 3, 1.5, 75]], [-4.7, 4.7]))
    expect(r.params!.platforms).toHaveLength(1)
    expect(r.params!.platforms[0]).toMatchObject({ kind: 'island', osmWays: [1000, 1001] })
    expect(r.confidence).toBeGreaterThanOrEqual(INTERIOR_MIN_CONFIDENCE)
  })

  it('does not read a 4-track station with one split island as two islands (not underground-express)', () => {
    const r = classifyStation(sub('D2', [[-4, 4, -75, -1.5], [-4, 4, 1.5, 75]], [-8.4, -4.7, 4.7, 8.4]))
    expect(r.params!.trackCount).toBe(4)
    expect(r.params!.platforms.filter((l) => l.kind === 'island')).toHaveLength(1)
    expect(r.archetype).toBe('cut-cover-mezzanine')
  })

  it('still reads two real islands, one of them split, as underground-express', () => {
    const r = classifyStation(sub('D3', [[-10, -4, -75, -1.5], [-10, -4, 1.5, 75], [4, 10]], [-12.2, -1.8, 1.8, 12.2]))
    expect(r.params!.platforms.filter((l) => l.kind === 'island')).toHaveLength(2)
    expect(r.archetype).toBe('underground-express')
  })

  it('keeps two platforms far apart along the axis separate', () => {
    const r = classifyStation(sub('D4', [[-3, 3, -75, -20], [-3, 3, 20, 75]], [-4.7, 4.7]))
    expect(r.params!.platforms).toHaveLength(2)
  })
})

describe('bad geometry', () => {
  const withPlatform = (outline: [number, number][]): StationFacts => ({ ...fx.bedfordAv(), platforms: [{ osmWay: 77, outline, levelTag: '-2' }] })

  it('an empty outline is unknown, naming the way', () => {
    const r = classifyStation(withPlatform([]))
    expect(r).toMatchObject({ archetype: 'unknown', confidence: 0, params: null })
    expect(reasonsOf(r)).toMatch(/bad geometry: platform way 77: outline has fewer than 3 distinct points/)
  })

  it('a NaN vertex is unknown, not a misleading "no track" or "axis off"', () => {
    const r = classifyStation(withPlatform([[Number.NaN, 0], [1, 1], [2, 2]]))
    expect(r.archetype).toBe('unknown')
    expect(reasonsOf(r)).toMatch(/platform way 77: outline has a non-finite point/)
    expect(reasonsOf(r)).not.toMatch(/axis|within 60 m/)
  })

  it('a one-point track and a NaN entrance are dropped and named; the rest is still classified', () => {
    const f = fx.bedfordAv()
    f.tracks.push({ ref: 'BAD', source: 'osm', path: [[0, 0]] })
    f.entrances[0]!.at = [Number.NaN, 1]
    const r = classifyStation(f)
    expect(reasonsOf(r)).toMatch(/dropped track BAD: path has fewer than 2 points/)
    expect(reasonsOf(r)).toMatch(/dropped entrance 0: non-finite position/)
    expect(r.archetype).toBe('cut-cover-mezzanine')
    expect(r.params!.trackCount).toBe(2)
  })

  it('still fails the station on a bad platform ring, listing dropped tracks too', () => {
    const f = withPlatform([[0, 0], [1, 0], [Number.NaN, 2]])
    f.tracks[0]!.path = []
    expect(reasonsOf(classifyStation(f))).toMatch(/platform way 77: outline has a non-finite point[\s\S]*dropped track L08N/)
  })
})

describe('params for the template step', () => {
  it('carry the origin and an anchor at the station center', () => {
    const f = fx.bedfordAv()
    const p = classifyStation(f).params!
    expect(p.origin).toEqual(f.origin)
    const back = toGround(p.anchor, p.origin)
    expect(back.x).toBeCloseTo(p.center[0], 6)
    expect(back.z).toBeCloseTo(p.center[1], 6)
  })
})

describe('a mezzanine inferred from weak evidence costs 0.1', () => {
  it('OSM level -1 alone', () => {
    const r = classifyStation(fx.seventyNinthSt1())
    expect(reasonsOf(r)).toMatch(/inferred from OSM level -1 alone: -0.1/)
    expect(r.confidence).toBeCloseTo(0.9, 5)
  })

  it('an entrance over a side platform', () => {
    const f = fx.buildStation('M1', 'subway', 40, [[-7.5, -3.5], [3.5, 7.5]], [-1.85, 1.85], { entrances: [[-60, -6], [60, 6]] })
    const r = classifyStation(f)
    expect(reasonsOf(r)).toMatch(/inferred from an entrance within 6 m of a side platform: -0.1/)
    expect(r.archetype).toBe('shallow-per-direction')
    expect(r.confidence).toBeCloseTo(0.9, 5)
  })
})
