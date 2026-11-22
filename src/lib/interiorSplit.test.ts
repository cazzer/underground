import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Connector, StationInterior as Interior } from '../data/stationSchema'
import { CAR_FLOOR_M, CAR_HEIGHT_M } from './carDims'
import { buildInteriorBuffers, trainLevelIndex, trainRoofY, type Buffers } from './interiorGeometry'
import { color, count, ELEVATOR, fixture, opts, ROLES, seg, STAIR } from './interiorFixture'
import { SegmentWriter, SplitAtY } from './interiorSegments'

/** Role and level (from the fixture's colorOf) of every segment's start. */
const tags = (b: Buffers) =>
  Array.from({ length: count(b) }, (_, k) => {
    const [role, level] = color(b, k)
    return `${ROLES[role!]}:${level}`
  })
const roleCount = (b: Buffers, role: string) => tags(b).filter((t) => t.startsWith(`${role}:`)).length
const ROLE_INDEX = (role: string) => ROLES.indexOf(role as (typeof ROLES)[number])
/** y range of every segment of a role. */
const ys = (b: Buffers, role: string) =>
  Array.from({ length: count(b) }, (_, k) => k)
    .filter((k) => color(b, k)[0] === ROLE_INDEX(role))
    .flatMap((k) => [seg(b, k)[1]!, seg(b, k)[4]!])
/** Total 3D length of a role's segments. */
const length = (b: Buffers, role: string) =>
  Array.from({ length: count(b) }, (_, k) => k)
    .filter((k) => color(b, k)[0] === ROLE_INDEX(role))
    .reduce((n, k) => {
      const [ax, ay, az, bx, by, bz] = seg(b, k) as [number, number, number, number, number, number]
      return n + Math.hypot(bx - ax, by - ay, bz - az)
    }, 0)

describe('SplitAtY', () => {
  const setup = () => {
    const below = new SegmentWriter()
    const above = new SegmentWriter()
    return { below, above, split: new SplitAtY(below, above, 1) }
  }

  it('routes a segment wholly on one side, the split height counting as below', () => {
    const { below, above, split } = setup()
    split.segment([0, 0, 0], [1, 1, 0], [0, 0, 0])
    split.segment([0, 1, 0], [1, 3, 0], [0, 0, 0])
    expect([below.build(), above.build()].map(count)).toEqual([1, 1])
  })

  it('cuts a crossing segment at the height, either way up, interpolating its color', () => {
    const { below, above, split } = setup()
    split.segment([0, 0, 0], [4, 4, 0], [0, 0, 0], [4, 8, 0])
    split.segment([4, 4, 0], [0, 0, 0], [4, 8, 0], [0, 0, 0])
    const [b, a] = [below.build(), above.build()]
    expect(seg(b, 0)).toEqual([0, 0, 0, 1, 1, 0])
    expect(seg(a, 0)).toEqual([1, 1, 0, 4, 4, 0])
    expect(Array.from(b.colors.subarray(3, 6))).toEqual([1, 2, 0])
    expect(seg(a, 1)).toEqual([4, 4, 0, 1, 1, 0])
    expect(seg(b, 1)).toEqual([1, 1, 0, 0, 0, 0])
  })
})

describe('trainLevelIndex', () => {
  it('is the level of a single platform deck', () => {
    expect(trainLevelIndex(fixture())).toBe(2)
  })

  it('is the shallowest deck when platform tracks are on more than one level, warning once', () => {
    const twoDecks = fixture()
    twoDecks.platforms.push({ ...twoDecks.platforms[0]!, id: 'P2', level: 'mezz' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(twoDecks.levels.findIndex((l) => l.id === 'mezz')).toBe(1)
    expect(trainLevelIndex(twoDecks)).toBe(1)
    expect(trainLevelIndex(twoDecks)).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('shallowest deck')
    warn.mockRestore()
  })

  it('leaves every shipped single-deck interior on its deepest platform level (only two-deck ones differ)', () => {
    const dir = new URL('../../public/data/stations/', import.meta.url)
    const multi: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const f of readdirSync(dir)) {
      if (f === 'index.json' || !f.endsWith('.json')) continue
      const it2 = JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Interior
      const trackLevels = it2.levels.flatMap((l, i) =>
        it2.platforms.some((p) => p.level === l.id && p.tracks.length > 0) ? [i] : [])
      if (trackLevels.length > 1) multi.push(it2.stationId)
      else expect(trainLevelIndex(it2)).toBe(trackLevels[0])
    }
    warn.mockRestore()
    expect(multi).toEqual(['635'])
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

  it('keeps the platform level in the base layers and moves the levels above over', () => {
    // Platform 4 + track 1 + the elevator's doored square at the platform 5 + the shaft's four feet; its cab 4.
    expect(new Set(tags(split.strong))).toEqual(new Set(['outline:2', 'track:2', 'elevator:2']))
    expect(count(split.strong)).toBe(4 + 1 + 5 + 4)
    expect(new Set(tags(split.fine))).toEqual(new Set(['elevator:2']))
    expect(count(split.fine)).toBe(4)
    // The rest of the shaft and the stop at the mezzanine go over with the slab, stair and entrance.
    expect(count(split.overStrong)).toBe(4 + 4 + 4 + 5 + 4)
    expect(roleCount(split.overStrong, 'elevator')).toBe(4 + 5)
    expect(tags(split.overStrong)).not.toContain('outline:2')
  })

  it('cuts the shaft at the trains\' roof: its foot stays under them', () => {
    const roof = trainRoofY({ y: -8 }, 1.1, 2)
    expect(roof).toBeCloseTo((-8 - 1.1) * 2 + CAR_FLOOR_M + CAR_HEIGHT_M)
    expect(Math.max(...ys(split.strong, 'elevator'))).toBeCloseTo(roof)
    expect(Math.min(...ys(split.overStrong, 'elevator'))).toBeCloseTo(roof)
    expect(length(split.strong, 'elevator') + length(split.overStrong, 'elevator')).toBeCloseTo(length(whole.strong, 'elevator'))
  })

  it('splits without losing a segment; only the shaft\'s four verticals are cut in two', () => {
    expect(count(split.strong) + count(split.overStrong)).toBe(count(whole.strong) + 4)
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

describe('a platform stair and escalator through the split', () => {
  const up = (c: Connector, id: string, kind: Connector['kind']): Connector => ({
    ...c,
    id,
    kind,
    lower: { ...c.lower, level: 'plat' },
    upper: { ...c.upper, level: 'mezz' },
  })
  const interior = fixture([STAIR, ELEVATOR, up(STAIR, 'ST2', 'stair'), { ...up(STAIR, 'ES1', 'escalator'), travel: 'up' }])
  const whole = buildInteriorBuffers(interior, opts())
  const out = buildInteriorBuffers(interior, opts({ splitLevel: 2 }))
  const roof = trainRoofY({ y: -8 }, 1.1, 2)

  it.each(['stair', 'escalator'])('draws the %s\'s foot, up to the roof, under the trains and the rest over', (role) => {
    expect(Math.min(...ys(out.strong, role))).toBeCloseTo(-16)
    expect(Math.max(...ys(out.strong, role))).toBeCloseTo(roof)
    expect(Math.min(...ys(out.overStrong, role))).toBeCloseTo(roof)
    expect(length(out.strong, role) + length(out.overStrong, role)).toBeCloseTo(length(whole.strong, role))
  })

  it('keeps the step hatches and handrails below the roof under the trains', () => {
    for (const role of ['step', 'escalator']) {
      expect(ys(out.fine, role).length).toBeGreaterThan(0)
      expect(Math.max(...ys(out.fine, role))).toBeLessThanOrEqual(roof + 1e-6)
      expect(Math.min(...ys(out.overFine, role))).toBeGreaterThanOrEqual(roof - 1e-6)
    }
  })
})

describe('L08 (Bedford Av) split at its platform', () => {
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Interior
  const l08 = read('../../public/data/stations/L08.json')
  const platform = trainLevelIndex(l08)
  const out = buildInteriorBuffers(l08, opts({ splitLevel: platform }))

  it('splits at the platform, the deepest level', () => {
    expect(platform).toBe(2)
    expect(l08.levels[2]!.kind).toBe('platform')
  })

  it('keeps the platform level and the feet of its stairs and elevator, up to the roof, under the trains', () => {
    const levelTags = new Set([...tags(out.strong), ...tags(out.fine)].map((t) => t.split(':')[0]))
    expect(levelTags).toEqual(new Set(['outline', 'track', 'elevator', 'stair', 'step']))
    const railY = (l08.levels[2]!.y - 1.1) * 2
    const roof = trainRoofY(l08.levels[2]!, 1.1, 2)
    for (const b of [out.strong, out.fine]) {
      for (let k = 0; k < count(b); k++) {
        const s = seg(b, k)
        expect(Math.max(s[1]!, s[4]!)).toBeLessThanOrEqual(roof + 1e-6)
        expect(Math.min(s[1]!, s[4]!)).toBeGreaterThanOrEqual(railY - 1e-6)
      }
    }
  })

  it('draws the rest of the three platform stairs, every other stair, both mezzanines and the street over the trains', () => {
    // Each platform stair's two sides are cut; its foot edge stays under, its head edge goes over.
    expect(roleCount(out.strong, 'stair')).toBe(3 * 3)
    expect(roleCount(out.overStrong, 'stair')).toBe(8 * 4 + 3 * 3)
    expect(tags(out.overStrong).filter((t) => t === 'outline:1')).toHaveLength(
      l08.slabs.reduce((n, s) => n + s.outline.length, 0),
    )
    expect(tags(out.overStrong)).toContain('entrance:0')
  })
})
