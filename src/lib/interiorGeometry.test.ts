import { describe, expect, it } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import { buildInteriorBuffers, type Buffers, type InteriorBufferOptions, type InteriorRole } from './interiorGeometry'

const ROLES: InteriorRole[] = ['outline', 'track', 'stair', 'elevator', 'entrance', 'step', 'guide', 'fare']

const STAIR: Connector = {
  id: 'ST1',
  kind: 'stair',
  lower: { x: 0, z: 10, level: 'mezz' },
  upper: { x: 7, z: 10, level: 'street' },
  width: 2,
  sources: ['authored'],
}

const ELEVATOR: Connector = {
  id: 'EL1',
  kind: 'elevator',
  lower: { x: 3, z: 0, level: 'plat' },
  upper: { x: 3, z: 0, level: 'mezz' },
  width: 2,
  sources: ['authored'],
}

function fixture(connectors: Connector[] = [STAIR, ELEVATOR]): StationInterior {
  return {
    stationId: 'X01',
    name: 'Fixture',
    anchor: { lat: 40.7, lon: -73.9 },
    license: 'ODbL-1.0',
    attribution: [],
    levels: [
      { id: 'street', name: 'Street', kind: 'street', y: 0 },
      { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: -4 },
      { id: 'plat', name: 'Platform', kind: 'platform', y: -8 },
    ],
    platforms: [
      {
        id: 'P1',
        level: 'plat',
        outline: [
          [-20, -3],
          [20, -3],
          [20, 3],
          [-20, 3],
        ],
        tracks: [{ stopId: 'X01N', path: [[-25, -5], [25, -5]] }],
        osmRef: 'way/1',
        sources: ['osm'],
      },
    ],
    slabs: [
      {
        id: 'S1',
        level: 'mezz',
        name: 'Mezzanine',
        outline: [
          [-5, 5],
          [5, 5],
          [5, 15],
          [-5, 15],
        ],
        sources: ['authored'],
      },
    ],
    connectors,
    entrances: [
      { id: 'E1', x: 9, z: 10, type: 'Stair', entry: true, exit: true, connectors: ['ST1'], sources: ['nyopendata'] },
    ],
    fareLines: [],
  }
}

const opts = (over: Partial<InteriorBufferOptions> = {}): InteriorBufferOptions => ({
  yScale: 2,
  stepRise: 0.18,
  railDrop: 1.1,
  entranceSize: 2.5,
  guides: true,
  colorOf: (role, i) => [ROLES.indexOf(role), i, 0],
  ...over,
})

const count = (b: Buffers) => b.positions.length / 6
/** Segment k as [ax, ay, az, bx, by, bz]. */
const seg = (b: Buffers, k: number) => Array.from(b.positions.subarray(k * 6, k * 6 + 6))
const color = (b: Buffers, k: number) => Array.from(b.colors.subarray(k * 6, k * 6 + 3))
const firstWith = (b: Buffers, role: InteriorRole, level: number) =>
  Array.from({ length: count(b) }, (_, k) => color(b, k)).findIndex((c) => c[0] === ROLES.indexOf(role) && c[1] === level)

describe('buildInteriorBuffers', () => {
  const { strong, fine } = buildInteriorBuffers(fixture(), opts())

  it('writes six floats per segment with parallel colors', () => {
    for (const b of [strong, fine]) {
      expect(b.positions.length % 6).toBe(0)
      expect(b.colors.length).toBe(b.positions.length)
    }
    // platform 4 + track 1 + slab 4 + stair 4 + elevator 12 + entrance 4
    expect(count(strong)).toBe(29)
    // round(4 / 0.18) - 1 = 21 steps, 4 slab guides and the 4-edge slab footprint at street level
    expect(count(fine)).toBe(29)
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

  it('draws elevators as a 12-edge box spanning both levels', () => {
    const k = firstWith(strong, 'elevator', 2)
    const box = Array.from({ length: 12 }, (_, i) => seg(strong, k + i))
    for (const s of box) {
      for (const x of [s[0]!, s[3]!]) expect(Math.abs(x - 3)).toBeLessThanOrEqual(1)
      for (const z of [s[2]!, s[5]!]) expect(Math.abs(z)).toBeLessThanOrEqual(1)
      for (const y of [s[1]!, s[4]!]) expect([-16, -8]).toContain(y)
    }
    expect(box.filter((s) => s[1] !== s[4])).toHaveLength(4)
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

  it('draws no guides from the platform', () => {
    expect(firstWith(fine, 'guide', 2)).toBe(-1)
  })

  it('skips guides when asked, and ramps get no steps', () => {
    expect(count(buildInteriorBuffers(fixture(), opts({ guides: false })).fine)).toBe(21)
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
