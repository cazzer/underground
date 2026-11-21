import { describe, expect, it } from 'vitest'
import type { DepthSource, StationInterior } from '../../src/data/stationSchema.ts'
import { INTERIOR_MIN_CONFIDENCE } from './archetype.ts'
import { fixture } from './stationFixture.ts'
import type { GeneratedMeta } from './stationInputs.ts'
import { buildStationInterior } from './stationMerge.ts'
import { markGenerated } from './stationProvenance.ts'

const built = (): StationInterior => {
  const { authored, sources } = fixture()
  return buildStationInterior(authored, sources)
}
const nonStreet = (i: StationInterior) => i.levels.filter((l) => l.kind !== 'street')
const metaFor = (i: StationInterior, over: Partial<GeneratedMeta> = {}): GeneratedMeta => ({
  archetype: 'shallow-per-direction',
  confidence: 0.85,
  levelDepths: Object.fromEntries(nonStreet(i).map((l) => [l.id, 'osm-level' as DepthSource])),
  ...over,
})
const elements = (i: StationInterior) => [...i.platforms, ...i.slabs, ...i.connectors, ...i.entrances, ...i.fareLines]

describe('markGenerated', () => {
  it('replaces authored with generated in every element, sorted and deduped, keeping osm and nyopendata', () => {
    const base = built()
    const out = markGenerated(base, metaFor(base))
    expect(elements(base).some((e) => e.sources.includes('authored'))).toBe(true)
    for (const e of elements(out)) {
      expect(e.sources).not.toContain('authored')
      expect(e.sources).toEqual([...new Set(e.sources)].sort())
    }
    expect(out.platforms[0]!.sources).toEqual(['generated', 'osm'])
    expect(out.entrances[0]!.sources).toEqual(['nyopendata'])
    expect(elements(out).some((e) => e.sources.includes('nyopendata') && e.sources.includes('generated'))).toBe(true)
  })

  it('adds `generated` after attribution and a depthSource to every non-street level', () => {
    const base = built()
    const out = markGenerated(base, metaFor(base, { archetype: 'deep', confidence: 0.9 }))
    expect(out.generated).toEqual({ archetype: 'deep', confidence: 0.9 })
    expect(Object.keys(out).indexOf('generated')).toBe(Object.keys(out).indexOf('attribution') + 1)
    for (const l of out.levels) {
      if (l.kind === 'street') expect('depthSource' in l).toBe(false)
      else expect(l.depthSource).toBe('osm-level')
    }
    expect(out.levels.map(({ depthSource: _d, ...l }) => l)).toEqual(base.levels)
  })

  it('does not mutate its input, and an unmarked build has no `generated` key', () => {
    const base = built()
    const before = JSON.stringify(base)
    markGenerated(base, metaFor(base))
    expect(JSON.stringify(base)).toBe(before)
    expect('generated' in base).toBe(false)
  })

  it('throws when a non-street level has no depth source', () => {
    const base = built()
    const [first, ...rest] = nonStreet(base)
    const levelDepths = Object.fromEntries(rest.map((l) => [l.id, 'ee-rise' as DepthSource]))
    expect(() => markGenerated(base, metaFor(base, { levelDepths }))).toThrow(`missing level "${first!.id}"`)
  })

  it('throws when levelDepths names the street or an unknown level', () => {
    const base = built()
    const street = base.levels.find((l) => l.kind === 'street')!
    const good = metaFor(base).levelDepths
    expect(() => markGenerated(base, metaFor(base, { levelDepths: { ...good, [street.id]: 'ee-rise' } }))).toThrow(/street level/)
    expect(() => markGenerated(base, metaFor(base, { levelDepths: { ...good, nope: 'ee-rise' } }))).toThrow(/unknown level "nope"/)
  })

  it.each([NaN, Infinity, -0.1, 1.1])('throws on confidence %s', (confidence) => {
    const base = built()
    expect(() => markGenerated(base, metaFor(base, { confidence }))).toThrow(/confidence/)
  })

  it('throws below the interior bar and accepts exactly the bar', () => {
    const base = built()
    expect(() => markGenerated(base, metaFor(base, { confidence: INTERIOR_MIN_CONFIDENCE - 0.01 }))).toThrow(/below the interior bar/)
    expect(markGenerated(base, metaFor(base, { confidence: INTERIOR_MIN_CONFIDENCE })).generated?.confidence).toBe(INTERIOR_MIN_CONFIDENCE)
  })
})
