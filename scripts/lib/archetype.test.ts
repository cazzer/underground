import { describe, expect, it } from 'vitest'
import { INTERIOR_MIN_CONFIDENCE, classifyStation } from './archetype.ts'
import type { Archetype } from './archetype.ts'
import * as fx from './archetypeFixtures.ts'
import type { StationFacts } from './stationFacts.ts'
import { makeFrame } from './stationGeometry.ts'

const clears = (confidence: number): boolean => confidence >= INTERIOR_MIN_CONFIDENCE
const reasonsOf = (r: { reasons: string[] }): string => r.reasons.join('\n')

interface Row {
  name: string
  facts: StationFacts
  archetype: Archetype
  platformType: 'island' | 'side' | 'mixed'
  tracks: number
  /** A line that must appear among the reasons. */
  reason: RegExp
}

const rows: Row[] = [
  { name: 'Bedford Av (L), island, mezzanine from E&E', facts: fx.bedfordAv(), archetype: 'cut-cover-mezzanine', platformType: 'island', tracks: 2, reason: /mezzanine: EL358 serving text/ },
  { name: '1 Av (L), side platforms', facts: fx.firstAvL(), archetype: 'cut-cover-mezzanine', platformType: 'side', tracks: 2, reason: /mezzanine: EL1 serving text/ },
  { name: '79 St (1), shallow side platforms, 4 tracks', facts: fx.seventyNinthSt1(), archetype: 'shallow-per-direction', platformType: 'side', tracks: 4, reason: /no mezzanine, inferred from OSM level -1/ },
  { name: '96 St (1/2/3), two islands', facts: fx.ninetySixthSt123(), archetype: 'underground-express', platformType: 'island', tracks: 4, reason: /4 tracks with two island platforms/ },
  { name: 'Livonia Av, elevated 2 tracks', facts: fx.livoniaAv(), archetype: 'elevated-2-track', platformType: 'island', tracks: 2, reason: /elevated with 2 tracks/ },
  { name: '40 St-Lowery St, 3 tracks, two sides', facts: fx.fortiethStLowery(), archetype: 'elevated-3-track', platformType: 'side', tracks: 3, reason: /elevated with 3 tracks/ },
  { name: '61 St-Woodside, 3 tracks, island and side', facts: fx.sixtyFirstStWoodside(), archetype: 'elevated-3-track', platformType: 'mixed', tracks: 3, reason: /elevated with 3 tracks/ },
  { name: '191 St, deep from an E&E rise', facts: fx.oneNinetyFirstSt(), archetype: 'deep', platformType: 'island', tracks: 2, reason: /EL1 rises 55\.0 m, over 18\.3 m \(60 ft\)/ },
  { name: 'Avenue H, open cut, side platforms, 4 tracks', facts: fx.avenueH(), archetype: 'open-air', platformType: 'side', tracks: 4, reason: /open-air archetype/ },
]

describe('classifyStation on a station of each archetype', () => {
  it.each(rows)('$name', (row) => {
    const r = classifyStation(row.facts)
    expect(r.archetype).toBe(row.archetype)
    expect(r.params?.platformType).toBe(row.platformType)
    expect(r.params?.trackCount).toBe(row.tracks)
    expect(clears(r.confidence)).toBe(true)
    expect(reasonsOf(r)).toMatch(row.reason)
  })

  it('reads the Bedford Av axis and track offsets in the authoring frame', () => {
    const p = classifyStation(fx.bedfordAv()).params!
    expect(p.bearingDeg).toBeGreaterThan(125)
    expect(p.bearingDeg).toBeLessThan(135)
    expect(p.trackOffsetsV).toHaveLength(2)
    expect(Math.abs(p.trackOffsetsV[0]! + p.trackOffsetsV[1]!)).toBeLessThan(2)
    expect(p.platforms).toHaveLength(1)
    expect(p.platforms[0]!.edges.map((e) => e.side)).toEqual([-1, 1])
    expect(p.entranceSides.length).toBeGreaterThan(0)
  })

  it('finds entrances on both sides of 79 St, and the track refs beside each side platform', () => {
    const p = classifyStation(fx.seventyNinthSt1()).params!
    expect(p.perDirectionEntrances).toBe(true)
    expect(p.platforms.map((l) => l.edges.map((e) => e.trackRef))).toEqual([['T1'], ['T4']])
    expect(p.platforms.map((l) => l.edges.map((e) => e.side))).toEqual([[1], [-1]])
  })

  it('calls a pinned deep station deep whatever its geometry, so no template is used', () => {
    const r = classifyStation({ ...fx.bedfordAv(), stationId: '231' })
    expect(r.archetype).toBe('deep')
    expect(reasonsOf(r)).toMatch(/deep station \(docs\/research\/station-modeling\.md archetypes table\)/)
  })

  it('calls any station with an E&E rise over 60 ft deep, elevated ones too', () => {
    const tall = fx.livoniaAv()
    tall.equipment = [fx.equipmentFact('EL9', 'street to platform for service in both directions', "61' - 0in")]
    expect(classifyStation(tall).archetype).toBe('deep')
    tall.equipment = [fx.equipmentFact('EL9', 'street to platform for service in both directions', "59' - 0in")]
    expect(classifyStation(tall).archetype).toBe('elevated-2-track')
  })

  it('puts 191 St 55 m down, from the E&E rise', () => {
    const d = classifyStation(fx.oneNinetyFirstSt()).params!.depths
    expect(d.platform.source).toBe('ee-rise')
    expect(d.platform.y).toBeCloseTo(-55.02, 2)
  })
})

describe('edge cases', () => {
  it('reads a split island (two half polygons, no track between) as one island platform', () => {
    const f = fx.buildStation('X1', 'subway', 40, [[-3.3, -0.2], [0.2, 3.3]], [-4.7, 4.7], { levelTags: ['-2'], equipment: [fx.equipmentFact('E', 'mezzanine to platform')] })
    const r = classifyStation(f)
    expect(r.archetype).toBe('cut-cover-mezzanine')
    expect(r.params!.platforms).toHaveLength(1)
    expect(r.params!.platforms[0]).toMatchObject({ kind: 'island', osmWays: [1000, 1001] })
    expect(r.params!.platforms[0]!.widthM).toBeCloseTo(6.6, 1)
    expect(clears(r.confidence)).toBe(true)
  })

  it('does not merge two platform polygons across a track', () => {
    const r = classifyStation(fx.firstAvL())
    expect(r.params!.platforms).toHaveLength(2)
  })

  it('penalizes two polygons 4 m or more apart with no track between them', () => {
    const f = fx.buildStation('X2', 'subway', 40, [[-6, -2.5], [2.5, 6]], [-9, 9], { levelTags: ['-2'], equipment: [fx.equipmentFact('E', 'mezzanine to platform')] })
    expect(reasonsOf(classifyStation(f))).toMatch(/at least 4 m apart with no track between them: -0.2/)
  })

  it('falls back to the polygon alone with no tracks, capped at 0.5 and not used for an interior', () => {
    const f = { ...fx.buildStation('X3', 'subway', 40, [[-3.3, 3.3]], [], { levelTags: ['-2'], equipment: [fx.equipmentFact('E', 'mezzanine to platform')] }) }
    const r = classifyStation(f)
    expect(r.params).toMatchObject({ platformType: 'island', trackCount: 2 })
    expect(r.confidence).toBeLessThanOrEqual(0.5)
    expect(clears(r.confidence)).toBe(false)
    expect(reasonsOf(r)).toMatch(/no track within 60 m of any platform: one merged polygon at least 5 m wide read as an island/)
  })

  it('falls back to two parallel polygons as side platforms', () => {
    const f = fx.buildStation('X4', 'subway', 40, [[-12, -8], [8, 12]], [], { levelTags: ['-1'] })
    expect(classifyStation(f).params?.platformType).toBe('side')
  })

  it('ignores tracks 60 m or more from the platform and falls back', () => {
    const f = fx.buildStation('X5', 'subway', 40, [[-3.3, 3.3]], [200, 210], { levelTags: ['-2'] })
    expect(classifyStation(f).params?.platforms[0]!.edges[0]!.trackRef).toBe('estimated')
  })

  it('gives up on a station complex', () => {
    const r = classifyStation({ ...fx.bedfordAv(), complex: true })
    expect(r.archetype).toBe('unknown')
    expect(r.params).toBeNull()
    expect(r.confidence).toBeLessThanOrEqual(0.2)
  })

  it('gives up on platforms at different OSM levels', () => {
    const f = fx.buildStation('X6', 'subway', 40, [[-10, -4], [4, 10]], [-12.2, -1.8, 1.8, 12.2], { levelTags: ['-1', '-2'] })
    const r = classifyStation(f)
    expect(r.archetype).toBe('unknown')
    expect(r.confidence).toBeLessThanOrEqual(0.3)
    expect(reasonsOf(r)).toMatch(/2 different OSM levels/)
  })

  it('does not treat a multi-level tag as one level', () => {
    const f = fx.buildStation('X7', 'subway', 40, [[-3.3, 3.3]], [-4.7, 4.7], { levelTags: ['-1;-2'] })
    expect(reasonsOf(classifyStation(f))).toMatch(/"-1;-2" does not name one level/)
  })

  it('drops the sections where a track is drawn inside the polygon and still votes with the rest', () => {
    const f = fx.buildStation('X8', 'subway', 40, [[-3.3, 3.3]], [-4.7, 4.7], { levelTags: ['-2'], equipment: [fx.equipmentFact('E', 'mezzanine to platform')] })
    const { fromUV } = makeFrame({ anchor: { lat: 40.7, lon: -74 }, bearingDeg: 40 })
    f.tracks.push({ ref: 'BAD', source: 'osm', path: [fromUV([-110, 0]), fromUV([-20, 0])] })
    const r = classifyStation(f)
    expect(reasonsOf(r)).toMatch(/track BAD drawn inside a platform polygon/)
    expect(r.params).toMatchObject({ platformType: 'island', trackCount: 2 })
    expect(r.params!.platforms[0]!.kind).toBe('island')
  })

  it('has nothing to go on when a track is drawn inside the polygon the whole way', () => {
    const f = fx.buildStation('X9', 'subway', 40, [[-3.3, 3.3]], [0], { levelTags: ['-2'] })
    const r = classifyStation(f)
    expect(r.archetype).toBe('unknown')
    expect(reasonsOf(r)).toMatch(/drawn inside/)
  })

  it('ignores a steep crossing ramp when counting tracks', () => {
    const f = fx.buildStation('X10', 'subway', 40, [[-3.3, 3.3]], [-4.7, 4.7], { levelTags: ['-2'], equipment: [fx.equipmentFact('E', 'mezzanine to platform')] })
    const { fromUV } = makeFrame({ anchor: { lat: 40.7, lon: -74 }, bearingDeg: 40 })
    f.tracks.push({ ref: 'RAMP', source: 'osm', path: [fromUV([-4, -10]), fromUV([4, 10])] })
    const r = classifyStation(f)
    expect(r.params!.trackCount).toBe(2)
    expect(r.params!.trackOffsetsV).toHaveLength(2)
  })

  it('has no platforms, no interior', () => {
    const r = classifyStation({ ...fx.bedfordAv(), platforms: [] })
    expect(r).toMatchObject({ archetype: 'unknown', confidence: 0, params: null })
  })

  it('does not accept 1 or 5 tracks', () => {
    const one = classifyStation(fx.buildStation('X11', 'subway', 40, [[-4, -1]], [-3.5], { levelTags: ['-2'] }))
    expect(one.archetype).toBe('unknown')
    const five = classifyStation(fx.buildStation('X12', 'subway', 40, [[-12, -9], [9, 12]], [-6, -3, 0, 3, 6]))
    expect(five.archetype).toBe('unknown')
    expect(reasonsOf(five)).toMatch(/tracks is outside 1-4/)
  })

  it('wants 2 or 3 elevated tracks', () => {
    const r = classifyStation(fx.buildStation('X13', 'elevated', 40, [[-4, -1]], [-3.5]))
    expect(r.archetype).toBe('unknown')
    expect(r.confidence).toBeLessThanOrEqual(0.3)
  })

  it('sends a 3-track subway station with a mezzanine to unknown, capped at 0.4', () => {
    const f = fx.buildStation('X14', 'subway', 40, [[-9, -5], [7, 11]], [-3.2, 0.5, 4.2], { levelTags: ['-2'] })
    const r = classifyStation(f)
    expect(r.archetype).toBe('unknown')
    expect(r.confidence).toBeLessThanOrEqual(0.4)
  })

  it('rests a deep call on the OSM level alone at a 0.2 penalty', () => {
    const f = fx.buildStation('X15', 'subway', 40, [[-3.5, 3.5]], [-5.4, 5.4], { levelTags: ['-5'] })
    const r = classifyStation(f)
    expect(r.archetype).toBe('deep')
    expect(reasonsOf(r)).toMatch(/OSM level tag alone: -0.2/)
  })

  it('penalizes an elevated station tagged below the street, and one with no entrances', () => {
    const f = fx.buildStation('X16', 'elevated', 40, [[-3.2, 3.2]], [-5, 5], { levelTags: ['-1'], entrances: [] })
    const r = classifyStation(f)
    expect(reasonsOf(r)).toMatch(/below the street: -0.3/)
    expect(reasonsOf(r)).toMatch(/no entrances: -0.2/)
    expect(r.confidence).toBeCloseTo(0.4, 5) // -0.3 level, -0.2 entrances, -0.1 for a mezzanine inferred from level -1 alone
  })

  it('flags a side platform whose only track is on the side away from the other tracks', () => {
    const f = fx.buildStation('X19', 'subway', 40, [[-9, -5], [5, 9]], [-11, 11], { levelTags: ['-2'] })
    expect(reasonsOf(classifyStation(f))).toMatch(/track on the side away from the other tracks: -0.3/)
  })

  it('flags a platform of an unusual width', () => {
    const f = fx.buildStation('X17', 'subway', 40, [[-3, -2.8]], [-4.7, 4.7], { levelTags: ['-2'] })
    expect(reasonsOf(classifyStation(f))).toMatch(/wide, outside the usual/)
  })

  it('assumes a mezzanine, at -0.1, with nothing to say otherwise', () => {
    const r = classifyStation(fx.buildStation('X18', 'subway', 40, [[-3.3, 3.3]], [-4.7, 4.7]))
    expect(reasonsOf(r)).toMatch(/mezzanine assumed.*-0.1/)
    expect(r.archetype).toBe('cut-cover-mezzanine')
    expect(r.confidence).toBeCloseTo(0.9, 5)
  })
})
