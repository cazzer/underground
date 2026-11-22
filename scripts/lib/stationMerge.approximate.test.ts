import { describe, expect, it } from 'vitest'
import { fixture } from './stationFixture.ts'
import { buildStationInterior } from './stationMerge.ts'

const build = (mutate: (f: ReturnType<typeof fixture>) => void = () => {}) => {
  const f = fixture()
  mutate(f)
  return buildStationInterior(f.authored, f.sources)
}

describe('approximate markers', () => {
  it('leave a surveyed station without them', () => {
    const out = build()
    expect(out.approximate).toBeUndefined()
    expect(out.slabs.some((s) => 'approximate' in s)).toBe(false)
    expect(out.levels.some((l) => 'depthSource' in l)).toBe(false)
  })
  it('pass the interior flag, a slab flag and a level depthSource through', () => {
    const out = build((f) => {
      f.authored.approximate = true
      f.authored.slabs[0]!.approximate = true
      f.authored.levels[0]!.depthSource = 'ee-rise'
    })
    expect(out.approximate).toBe(true)
    expect(out.slabs[0]!.approximate).toBe(true)
    expect(out.levels.find((l) => l.id === 'platform')!.depthSource).toBe('ee-rise')
    expect(out.generated).toBeUndefined()
  })
  it('reject a non-true flag, an unknown depthSource and a depthSource on the street', () => {
    const bad = (v: unknown) => v as true
    expect(() => build((f) => { f.authored.approximate = bad(false) })).toThrow(/approximate: expected true or absent, got false/)
    expect(() => build((f) => { f.authored.slabs[0]!.approximate = bad('yes') })).toThrow(/slabs\[0\]\.approximate: expected true or absent/)
    expect(() => build((f) => { f.authored.levels[0]!.depthSource = 'guess' as never })).toThrow(/levels\[0\]\.depthSource: expected one of ee-rise/)
    expect(() => build((f) => { f.authored.levels[1]!.depthSource = 'ee-rise' })).toThrow(/levels\[1\]\.depthSource: the street level has no depth source/)
  })
})
