import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationInterior } from '../data/stationSchema'
import { buildInteriorBuffers, trainLevelIndex, type Buffers } from './interiorGeometry'
import { color, count, fixture, opts, ROLES, seg } from './interiorFixture'

/** Role and level (from the fixture's colorOf) of every segment's start. */
const tags = (b: Buffers) =>
  Array.from({ length: count(b) }, (_, k) => {
    const [role, level] = color(b, k)
    return `${ROLES[role!]}:${level}`
  })
const roleCount = (b: Buffers, role: string) => tags(b).filter((t) => t.startsWith(`${role}:`)).length

describe('trainLevelIndex', () => {
  it('is the deepest level with a platform track', () => {
    expect(trainLevelIndex(fixture())).toBe(2)
    const twoDecks = fixture()
    twoDecks.platforms.push({ ...twoDecks.platforms[0]!, id: 'P2', level: 'mezz' })
    expect(trainLevelIndex(twoDecks)).toBe(2)
  })

  it('is undefined when no platform has a track', () => {
    const base = fixture()
    expect(trainLevelIndex({ ...base, platforms: [{ ...base.platforms[0]!, tracks: [] }] })).toBeUndefined()
  })
})

describe('buildInteriorBuffers with splitLevel', () => {
  const whole = buildInteriorBuffers(fixture(), opts())
  const split = buildInteriorBuffers(fixture(), opts({ splitLevel: 2 }))

  it('without a split, draws everything in the base layers', () => {
    expect(count(whole.overStrong)).toBe(0)
    expect(count(whole.overFine)).toBe(0)
  })

  it('keeps the platform level in the base layers and moves the levels above, and connectors reaching them, over', () => {
    // Platform 4 + track 1 + the elevator's doored square at the platform 5; its cab 4.
    expect(new Set(tags(split.strong))).toEqual(new Set(['outline:2', 'track:2', 'elevator:2']))
    expect(count(split.strong)).toBe(4 + 1 + 5)
    expect(new Set(tags(split.fine))).toEqual(new Set(['elevator:2']))
    expect(count(split.fine)).toBe(4)
    // The shaft (from the platform up) and the stop at the mezzanine go over with the slab, stair and entrance.
    expect(count(split.overStrong)).toBe(4 + 4 + 4 + 5 + 4)
    expect(roleCount(split.overStrong, 'elevator')).toBe(4 + 5)
    expect(tags(split.overStrong)).not.toContain('outline:2')
  })

  it('splits without losing or adding a segment', () => {
    expect(count(split.strong) + count(split.overStrong)).toBe(count(whole.strong))
    expect(count(split.fine) + count(split.overFine)).toBe(count(whole.fine))
  })

  it('writes dash distances in all four layers: the platform outline dashes below, the slab and its guides over', () => {
    const dashed = buildInteriorBuffers(fixture(), opts({ splitLevel: 2, dashStructure: true }))
    for (const b of [dashed.strong, dashed.fine, dashed.overStrong, dashed.overFine]) {
      expect(b.distances.length).toBe(count(b) * 2)
    }
    const cut = (b: Buffers) => b.distances.filter((d) => d > 0).length
    expect(cut(dashed.strong)).toBe(4)
    expect(cut(dashed.overStrong)).toBe(4)
    expect(cut(dashed.fine)).toBe(0)
    expect(cut(dashed.overFine)).toBe(8)
  })
})

describe('L08 (Bedford Av) split at its platform', () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as StationInterior
  const l08 = read('../../public/data/stations/L08.json')
  const platform = trainLevelIndex(l08)
  const out = buildInteriorBuffers(l08, opts({ splitLevel: platform }))

  it('splits at the platform, the deepest level', () => {
    expect(platform).toBe(2)
    expect(l08.levels[2]!.kind).toBe('platform')
  })

  it('keeps only the platform outline, its tracks and the platform elevator stop under the trains', () => {
    expect(new Set([...tags(out.strong), ...tags(out.fine)])).toEqual(new Set(['outline:2', 'track:2', 'elevator:2']))
    const railY = (l08.levels[2]!.y - 1.1) * 2
    for (let k = 0; k < count(out.strong); k++) {
      const s = seg(out.strong, k)
      expect(Math.max(s[1]!, s[4]!)).toBeLessThanOrEqual(l08.levels[2]!.y * 2)
      expect(Math.min(s[1]!, s[4]!)).toBeGreaterThanOrEqual(railY - 1e-6)
    }
  })

  it('draws every stair (the three from the platform included), both mezzanines and the street over the trains', () => {
    expect(roleCount(out.overStrong, 'stair')).toBe(11 * 4)
    expect(roleCount(out.strong, 'stair')).toBe(0)
    expect(tags(out.overStrong).filter((t) => t === 'outline:1')).toHaveLength(
      l08.slabs.reduce((n, s) => n + s.outline.length, 0),
    )
    expect(tags(out.overStrong)).toContain('entrance:0')
  })
})
