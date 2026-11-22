import { describe, expect, it } from 'vitest'
import type { Connector } from '../data/stationSchema'
import { stationAxis } from './interiorAxis'
import { doorSide, inclineEnds } from './interiorConnectors'
import { buildInteriorBuffers, type Buffers, type InteriorRole } from './interiorGeometry'
import { count, ELEVATOR, fixture, opts, ROLES, seg } from './interiorFixture'

const ESCALATOR: Connector = {
  id: 'ES1',
  kind: 'escalator',
  lower: { x: 0, z: 10, level: 'mezz' },
  upper: { x: 6, z: 10, level: 'street' },
  width: 2,
  travel: 'up',
  sources: ['nyopendata'],
}

/** Buffers for the fixture with only these connectors, minus the fixture's own outlines, track, entrance and guides. */
function machines(connectors: Connector[]): { strong: Buffers; fine: Buffers } {
  return buildInteriorBuffers(fixture(connectors), opts({ guides: false }))
}

/** Segment indexes whose start color has this role. */
const withRole = (b: Buffers, role: InteriorRole) =>
  Array.from({ length: count(b) }, (_, k) => k).filter((k) => b.colors[k * 6] === ROLES.indexOf(role))

/** Strong segments of the fixture's platform, track, slab and entrance. */
const BASE_STRONG = 4 + 1 + 4 + 4

describe('elevators', () => {
  it('four shaft verticals, a doored square at each end, and a cab inside it', () => {
    const { strong, fine } = machines([ELEVATOR])
    expect(count(strong) - BASE_STRONG).toBe(4 + 5 + 5)
    expect(withRole(strong, 'elevator')).toHaveLength(14)
    expect(withRole(fine, 'elevator')).toHaveLength(8)
    const verticals = withRole(strong, 'elevator').map((k) => seg(strong, k)).filter((s) => s[1] !== s[4])
    expect(verticals).toHaveLength(4)
    for (const s of verticals) expect([s[1], s[4]]).toEqual([-16, -8])
    const cab = withRole(fine, 'elevator').map((k) => seg(fine, k))
    for (const s of cab) for (const v of [s[0]!, s[3]!]) expect(Math.abs(v - 3)).toBeCloseTo(0.5)
  })

  it('opens the door toward the plan center: a centered gap of 0.45 of the width', () => {
    // Fixture plan center is (0, 6), south of the shaft at (3, 0): the door is on the south side, z = 1.
    const { strong } = machines([ELEVATOR])
    const south = withRole(strong, 'elevator')
      .map((k) => seg(strong, k))
      .filter((s) => s[1] === -16 && s[4] === -16 && s[2] === 1 && s[5] === 1)
      .map((s) => [Math.min(s[0]!, s[3]!), Math.max(s[0]!, s[3]!)])
      .sort((p, q) => p[0]! - q[0]!)
    expect(south).toHaveLength(2)
    expect(south[0]![0]).toBeCloseTo(2)
    expect(south[1]![1]).toBeCloseTo(4)
    expect(south[1]![0]! - south[0]![1]!).toBeCloseTo(0.9)
    expect((south[0]![1]! + south[1]![0]!) / 2).toBeCloseTo(3)
  })

  it('picks the shaft side facing the center, south when the shaft sits on it', () => {
    expect(doorSide(ELEVATOR, [10, 1], [1, 0])).toBe(1)
    expect(doorSide(ELEVATOR, [-10, 1], [1, 0])).toBe(3)
    expect(doorSide(ELEVATOR, [3, -10], [1, 0])).toBe(0)
    expect(doorSide(ELEVATOR, [3, 0], [1, 0])).toBe(2)
    // Along a north-south axis, side 1 faces south and side 2 west.
    expect(doorSide(ELEVATOR, [3, 10], [0, 1])).toBe(1)
    expect(doorSide(ELEVATOR, [-10, 0], [0, 1])).toBe(2)
    expect(doorSide(ELEVATOR, [3, 0], [0, 1])).toBe(1)
  })

  it('squares the shaft to the station axis', () => {
    const i = fixture([ELEVATOR])
    // A platform running along (0.6, 0.8).
    const outline: [number, number][] = [[-12, -16], [12, 16], [9.6, 17.8], [-14.4, -14.2]]
    const { strong } = buildInteriorBuffers({ ...i, platforms: [{ ...i.platforms[0]!, outline }] }, opts({ guides: false }))
    const verticals = withRole(strong, 'elevator').map((k) => seg(strong, k)).filter((s) => s[1] !== s[4])
    for (const s of verticals) {
      const [du, dv] = [(s[0]! - 3) * 0.6 + s[2]! * 0.8, -(s[0]! - 3) * 0.8 + s[2]! * 0.6]
      expect(Math.abs(du)).toBeCloseTo(1)
      expect(Math.abs(dv)).toBeCloseTo(1)
    }
  })

  it('writes each stop in its own level pass: the upper stop after the mezzanine outline', () => {
    const { strong } = machines([ELEVATOR])
    const stops = withRole(strong, 'elevator').filter((k) => seg(strong, k)[1] === seg(strong, k)[4])
    const lowerStop = stops.filter((k) => strong.colors[k * 6 + 1] === 2)
    const upperStop = stops.filter((k) => strong.colors[k * 6 + 1] === 1)
    const slab = withRole(strong, 'outline').find((k) => strong.colors[k * 6 + 1] === 1)!
    expect(lowerStop).toHaveLength(5)
    expect(upperStop).toHaveLength(5)
    expect(Math.max(...lowerStop)).toBeLessThan(slab)
    expect(Math.min(...upperStop)).toBeGreaterThan(slab)
    for (const k of upperStop) expect(seg(strong, k)[1]).toBe(-8)
  })

  it('a platform-to-street elevator stops only at its ends; the shaft spans all three levels', () => {
    const { strong } = machines([{ ...ELEVATOR, upper: { ...ELEVATOR.upper, level: 'street' } }])
    const ys = withRole(strong, 'elevator').map((k) => seg(strong, k)).filter((s) => s[1] === s[4]).map((s) => s[1])
    expect(new Set(ys)).toEqual(new Set([-16, 0]))
    const verticals = withRole(strong, 'elevator').map((k) => seg(strong, k)).filter((s) => s[1] !== s[4])
    for (const s of verticals) expect([s[1], s[4]]).toEqual([-16, 0])
  })
})

describe('escalators', () => {
  it('a band in the escalator color, handrails at their real height, no step hatch', () => {
    const { strong, fine } = machines([ESCALATOR])
    const band = withRole(strong, 'escalator')
    expect(seg(strong, band[0]!)).toEqual([0, -8, 11, 6, 0, 11])
    expect(Array.from(strong.colors.subarray(band[0]! * 6, band[0]! * 6 + 6))).toEqual([8, 1, 0, 8, 0, 0])
    expect(withRole(fine, 'step')).toHaveLength(0)
    expect(withRole(fine, 'escalator')).toHaveLength(2)
    const rail = seg(fine, 0)
    expect(rail[1]).toBeCloseTo(-8 + 0.9)
    expect(rail[4]).toBeCloseTo(0.9)
    expect(rail[2]).toBeCloseTo(10 - 0.6)
  })

  const chevrons = (c: Connector) => {
    const { strong } = machines([c])
    return withRole(strong, 'escalator').slice(4).map((k) => seg(strong, k))
  }

  it('points 1.5 m chevrons in the travel direction, one per 4.5 m of run, arms at the band edges', () => {
    const up = chevrons(ESCALATOR)
    expect(up).toHaveLength(2)
    for (const s of up) expect(s[3]! - s[0]!).toBeCloseTo(1.5)
    expect(up.map((s) => s[2]!).sort((a, b) => a - b)).toEqual([9, 11])
    const down = chevrons({ ...ESCALATOR, travel: 'down' })
    expect(down).toHaveLength(2)
    for (const s of down) expect(s[3]! - s[0]!).toBeCloseTo(-1.5)
    expect(chevrons({ ...ESCALATOR, travel: undefined })).toHaveLength(0)
    expect(chevrons({ ...ESCALATOR, upper: { ...ESCALATOR.upper, x: 9.5 } })).toHaveLength(4)
  })

  it('keeps a chevron within 0.4 of a short run', () => {
    const short = chevrons({ ...ESCALATOR, upper: { ...ESCALATOR.upper, x: 3 } })
    for (const s of short) expect(s[3]! - s[0]!).toBeCloseTo(1.2)
  })

  it('lays a zero-run escalator at 30 degrees along the platform axis, centered on its point', () => {
    const { strong } = machines([{ ...ESCALATOR, travel: undefined, upper: { ...ESCALATOR.upper, x: 0 } }])
    const side = seg(strong, withRole(strong, 'escalator')[0]!)
    const half = (4 * Math.sqrt(3)) / 2
    expect(side[0]).toBeCloseTo(-half)
    expect(side[3]).toBeCloseTo(half)
    expect(side[2]).toBeCloseTo(11)
    expect(side[5]).toBeCloseTo(11)
  })

  const zeroRunAt = (x: number) => ({ ...ESCALATOR, lower: { ...ESCALATOR.lower, x }, upper: { ...ESCALATOR.upper, x } })
  /** [lower x, upper x] of a zero-run escalator's first band side. */
  const ends = (i: ReturnType<typeof fixture>) => {
    const { strong } = buildInteriorBuffers(i, opts({ guides: false }))
    const s = seg(strong, withRole(strong, 'escalator')[0]!)
    return [s[0]!, s[3]!]
  }

  it('descends a zero-run escalator toward the plan center', () => {
    const half = (4 * Math.sqrt(3)) / 2
    const [east, eastUp] = ends(fixture([zeroRunAt(10)]))
    expect(east).toBeCloseTo(10 - half)
    expect(eastUp).toBeCloseTo(10 + half)
    const [west, westUp] = ends(fixture([zeroRunAt(-10)]))
    expect(west).toBeCloseTo(-10 + half)
    expect(westUp).toBeCloseTo(-10 - half)
  })

  /** The fixture with entrance E1 (at x 9, z 10) listing these connector ids. */
  const listedBy = (connectors: Connector[], ids: string[]) => {
    const i = fixture(connectors)
    return { ...i, entrances: [{ ...i.entrances[0]!, connectors: ids }] }
  }

  it('pins a zero-run escalator at the street entrance that lists it, running toward the center', () => {
    const [lower, upper] = ends(listedBy([zeroRunAt(9)], ['ES1']))
    expect(upper).toBeCloseTo(9)
    expect(lower).toBeCloseTo(9 - 4 * Math.sqrt(3))
  })

  it('pins the street end at the entrance: the upper end below ground, the lower end at an elevated station', () => {
    const c = zeroRunAt(9)
    const anchor = { point: [9, 10] as [number, number], atEntrance: true, lateral: 0 }
    const run = 4 * Math.sqrt(3)
    const below = inclineEnds(c, 4, [1, 0], [0, 0], anchor)
    expect(below.upper).toEqual([9, 10])
    expect(below.lower[0]).toBeCloseTo(9 - run)
    const elevated = inclineEnds(c, 4, [1, 0], [0, 0], anchor, 'lower')
    expect(elevated.lower).toEqual([9, 10])
    expect(elevated.upper[0]).toBeCloseTo(9 - run)
    // Centered runs ignore which end is the street.
    expect(inclineEnds(c, 4, [1, 0], [0, 0], { ...anchor, atEntrance: false }, 'lower')).toEqual(inclineEnds(c, 4, [1, 0], [0, 0], { ...anchor, atEntrance: false }))
  })

  it('draws an elevated station\'s street escalator up from its entrance toward the center', () => {
    const base = listedBy([{ ...zeroRunAt(9), lower: { x: 9, z: 10, level: 'street' }, upper: { x: 9, z: 10, level: 'mezz' } }], ['ES1'])
    const elevated = {
      ...base,
      levels: [
        { id: 'plat', name: 'Platform', kind: 'platform' as const, y: 8 },
        { id: 'mezz', name: 'Station house', kind: 'mezzanine' as const, y: 4 },
        { id: 'street', name: 'Street', kind: 'street' as const, y: 0 },
      ],
    }
    const [lower, upper] = ends(elevated)
    expect(lower).toBeCloseTo(9)
    expect(upper).toBeCloseTo(9 - 4 * Math.sqrt(3))
  })

  it('keeps an authored `at` off the entrance: the run is centered on its own point', () => {
    const half = (4 * Math.sqrt(3)) / 2
    const [lower, upper] = ends(listedBy([zeroRunAt(-10)], ['ES1']))
    expect(lower).toBeCloseTo(-10 + half)
    expect(upper).toBeCloseTo(-10 - half)
  })

  it('draws a two-escalator bank at one entrance as two parallel bands, 0.3 m apart', () => {
    const second = { ...zeroRunAt(9), id: 'ES2' }
    const i = listedBy([{ ...second, travel: undefined }, { ...zeroRunAt(9), travel: undefined }], ['ES1', 'ES2'])
    const { strong } = buildInteriorBuffers(i, opts({ guides: false }))
    const sides = withRole(strong, 'escalator').map((k) => seg(strong, k)).filter((s) => s[1] !== s[4])
    expect(sides).toHaveLength(4)
    for (const s of sides) {
      expect(s[2]).toBeCloseTo(s[5]!)
      expect([s[0], s[3]].sort((a, b) => a! - b!)[1]).toBeCloseTo(9)
    }
    const zs = sides.map((s) => s[2]!).sort((a, b) => a - b)
    expect(zs).toEqual([7.85, 9.85, 10.15, 12.15].map((z) => expect.closeTo(z)))
  })
})

describe('stationAxis', () => {
  it('follows the length of the longest platform, pointing east', () => {
    const i = fixture()
    const diagonal = [[0, 0], [-30, -40], [-31, -39], [-1, 1]] as [number, number][]
    const axis = stationAxis({ ...i, platforms: [{ ...i.platforms[0]!, outline: diagonal }] })
    expect(axis[0]).toBeCloseTo(0.6)
    expect(axis[1]).toBeCloseTo(0.8)
  })

  it('reads a subdivided outline along its length, not along a long end cap', () => {
    // 40 m by 8 m, long sides split into 4 m edges: the 8 m end caps are the longest single edges.
    const north = Array.from({ length: 11 }, (_, k): [number, number] => [-20 + 4 * k, -4])
    const south = Array.from({ length: 11 }, (_, k): [number, number] => [20 - 4 * k, 4])
    const i = fixture()
    const axis = stationAxis({ ...i, platforms: [{ ...i.platforms[0]!, outline: [...north, ...south] }] })
    expect(axis[0]).toBeCloseTo(1)
    expect(axis[1]).toBeCloseTo(0)
  })

  it('falls back to +x with no platforms', () => {
    expect(stationAxis({ ...fixture(), platforms: [] })).toEqual([1, 0])
  })
})

describe('walkways', () => {
  const WALKWAY: Connector = {
    id: 'WK1',
    kind: 'walkway',
    lower: { x: -3, z: 8, level: 'mezz' },
    upper: { x: 3, z: 8, level: 'mezz' },
    width: 2,
    sources: ['authored'],
  }
  /** Indexes of the strong segments that run x -3 to 3 at drawn height `y`: only a walkway's sides here. */
  const sidesAt = (b: Buffers, y: number) =>
    Array.from({ length: count(b) }, (_, k) => k).filter((k) => {
      const s = seg(b, k)
      return s[0] === -3 && s[3] === 3 && s[1] === y && s[4] === y
    })

  it('draws two strong side edges in the outline color at the level, half the width either side, and no end caps', () => {
    const { strong, fine } = machines([WALKWAY])
    expect(count(strong) - BASE_STRONG).toBe(2)
    expect(count(fine)).toBe(0)
    const sides = sidesAt(strong, -8)
    expect(sides).toHaveLength(2)
    expect(sides.map((k) => seg(strong, k)[2]).sort()).toEqual([7, 9])
    for (const k of sides) expect(strong.colors[k * 6]).toBe(ROLES.indexOf('outline'))
  })

  it('is flat on its level whichever level that is', () => {
    const { strong } = machines([
      { ...WALKWAY, lower: { ...WALKWAY.lower, level: 'plat' }, upper: { ...WALKWAY.upper, level: 'plat' } },
    ])
    expect(sidesAt(strong, -16)).toHaveLength(2)
  })

  it('throws for a walkway with no plan run', () => {
    expect(() => machines([{ ...WALKWAY, upper: { ...WALKWAY.lower } }])).toThrow(/no horizontal run/)
  })

  it('dashes its sides on an estimated layout, and only then', () => {
    const solid = buildInteriorBuffers(fixture([WALKWAY]), opts({ guides: false })).strong
    const dashed = buildInteriorBuffers(fixture([WALKWAY]), opts({ guides: false, dashStructure: true })).strong
    const distances = (b: Buffers) => sidesAt(b, -8).map((k) => Array.from(b.distances.subarray(k * 2, k * 2 + 2)))
    expect(distances(solid)).toEqual([[0, 0], [0, 0]])
    expect(distances(dashed)).toEqual([[0, 6], [0, 6]])
  })
})
