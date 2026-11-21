import { describe, expect, it } from 'vitest'
import { buildInteriorBuffers } from './interiorGeometry'
import { color, count, firstWith, fixture, opts, ROLES, seg, STAIR } from './interiorFixture'

describe('buildInteriorBuffers', () => {
  const { strong, fine } = buildInteriorBuffers(fixture(), opts())

  it('writes six floats per segment with parallel colors', () => {
    for (const b of [strong, fine]) {
      expect(b.positions.length % 6).toBe(0)
      expect(b.colors.length).toBe(b.positions.length)
    }
    // platform 4 + track 1 + slab 4 + stair 4 + elevator (4 shaft + 5 doored square at each end) 14 + entrance 4
    expect(count(strong)).toBe(31)
    // round(4 / 0.18) - 1 = 21 steps, 4 slab guides, the 4-edge slab footprint at street level, 2 × 4 cab edges
    expect(count(fine)).toBe(37)
  })

  it('places the platform at its scaled level, the track at rail height and entrances at the street', () => {
    const outline = seg(strong, firstWith(strong, 'outline', 2))
    expect(outline[1]).toBe(-16)
    const track = seg(strong, firstWith(strong, 'track', 2))
    expect(track[1]).toBeCloseTo((-8 - 1.1) * 2)
    expect(track[4]).toBeCloseTo((-8 - 1.1) * 2)
    const entrance = seg(strong, firstWith(strong, 'entrance', 0))
    expect(entrance[1]).toBe(0)
  })

  it('offsets stair edges by half the width across the run', () => {
    const k = firstWith(strong, 'stair', 1)
    expect(seg(strong, k)).toEqual([0, -8, 11, 7, 0, 11])
    expect(seg(strong, k + 1)).toEqual([0, -8, 9, 7, 0, 9])
    expect(color(strong, k)).toEqual([2, 1, 0])
    expect(Array.from(strong.colors.subarray(k * 6 + 3, k * 6 + 6))).toEqual([2, 0, 0])
  })

  it('hatches stair steps at even fractions of the run, with colors lerped between levels', () => {
    // Step colors are lerped, so match the role channel only.
    const k = Array.from({ length: count(fine) }, (_, i) => color(fine, i)[0]).indexOf(ROLES.indexOf('step'))
    const s = seg(fine, k)
    const t = 1 / 22
    expect(s[0]).toBeCloseTo(7 * t)
    expect(s[1]).toBeCloseTo(-8 + 8 * t)
    expect(s[2]).toBeCloseTo(9)
    expect(s[5]).toBeCloseTo(11)
    expect(color(fine, k)[1]).toBeCloseTo(1 - t)
  })

  it('scales only y with yScale', () => {
    const one = buildInteriorBuffers(fixture(), opts({ yScale: 1 }))
    expect(one.strong.positions.length).toBe(strong.positions.length)
    for (let i = 0; i < strong.positions.length; i++) {
      const expected = i % 3 === 1 ? one.strong.positions[i]! * 2 : one.strong.positions[i]!
      expect(strong.positions[i]).toBeCloseTo(expected)
    }
  })

  it('draws deeper levels first', () => {
    const platform = firstWith(strong, 'outline', 2)
    const slab = firstWith(strong, 'outline', 1)
    const entrance = firstWith(strong, 'entrance', 0)
    expect(platform).toBeGreaterThanOrEqual(0)
    expect(platform).toBeLessThan(slab)
    expect(slab).toBeLessThan(entrance)
  })

  it('colors slab guides from their level up to the street, and repeats the slab at street level', () => {
    const k = firstWith(fine, 'guide', 1)
    const s = seg(fine, k)
    expect(s[1]).toBe(-8)
    expect(s[4]).toBe(0)
    expect(Array.from(fine.colors.subarray(k * 6 + 3, k * 6 + 6))).toEqual([6, 0, 0])
    const footprint = Array.from({ length: count(fine) }, (_, i) => seg(fine, i)).filter((g) => g[1] === 0 && g[4] === 0)
    expect(footprint).toHaveLength(4)
  })

  it('colors the guides\' street end with the street level at an elevated station, where the street is the last level', () => {
    const base = fixture([])
    const elevated = {
      ...base,
      levels: [
        { id: 'plat', name: 'Platform', kind: 'platform' as const, y: 8 },
        { id: 'mezz', name: 'Station house', kind: 'mezzanine' as const, y: 4 },
        { id: 'street', name: 'Street', kind: 'street' as const, y: 0 },
      ],
    }
    const out = buildInteriorBuffers(elevated, opts()).fine
    const k = firstWith(out, 'guide', 1)
    expect(seg(out, k)[4]).toBe(0)
    expect(Array.from(out.colors.subarray(k * 6 + 3, k * 6 + 6))).toEqual([6, 2, 0])
  })

  it('draws no guides from the platform', () => {
    expect(firstWith(fine, 'guide', 2)).toBe(-1)
  })

  it('skips guides when asked, and ramps get no steps', () => {
    expect(count(buildInteriorBuffers(fixture([STAIR]), opts({ guides: false })).fine)).toBe(21)
    const ramp = buildInteriorBuffers(fixture([{ ...STAIR, kind: 'ramp' }]), opts({ guides: false }))
    expect(count(ramp.fine)).toBe(0)
    expect(count(ramp.strong)).toBe(4 + 1 + 4 + 4 + 4)
  })

  it('throws naming the element for an unknown level', () => {
    const bad = fixture([{ ...STAIR, upper: { ...STAIR.upper, level: 'roof' } }])
    expect(() => buildInteriorBuffers(bad, opts())).toThrow('Unknown level "roof" in ST1')
  })

  it('throws for a stair with no horizontal run', () => {
    const bad = fixture([{ ...STAIR, upper: { ...STAIR.upper, x: 0 } }])
    expect(() => buildInteriorBuffers(bad, opts())).toThrow('Connector "ST1" has no horizontal run')
  })
})
