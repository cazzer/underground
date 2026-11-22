import { describe, expect, it } from 'vitest'
import { corridorBands, type CorridorShape, type ShapeBands } from './corridors'
import { shareBands } from './corridorShare'
import type { Ground } from './projection'
import { buildPolyline } from './realtime/polyline'
import { indexTrack, sharedRuns, type SharedRun } from './sharedTrack'
import { EMPTY_PROFILE, type TrackProfile } from './trackProfile'

/** Points every 100 m north along x from z0 to z1 (z1 < z0). */
function north(x: number, z0: number, z1: number): Ground[] {
  const out: Ground[] = []
  for (let z = z0; z > z1; z -= 100) out.push({ x, z })
  out.push({ x, z: z1 })
  return out
}

const runsOf = (variant: Ground[], primary: Ground[]) =>
  sharedRuns(buildPolyline(variant), indexTrack(buildPolyline(primary))).map((r) => ({ v: [...r.v], p: [...r.p] }))

describe('sharedRuns', () => {
  const primary = north(0, 0, -3000)

  it('pairs the distances along a stretch on the same points, until the variant turns off', () => {
    // On the primary from 1015 m to 2000 m along it, then off to the east.
    const variant = [{ x: 0, z: -1015 }, ...north(0, -1100, -2000), { x: 50, z: -2500 }]
    const [run, ...rest] = runsOf(variant, primary)
    expect(rest).toEqual([])
    expect(run!.v[0]).toBe(0)
    expect(run!.v.at(-1)).toBeCloseTo(985, 9)
    run!.p.forEach((p, i) => expect(p - run!.v[i]!).toBeCloseTo(1015, 9))
  })

  it('finds none on a parallel track, even 5 cm off', () => {
    expect(runsOf(north(4.7, 0, -3000), primary)).toEqual([])
    expect(runsOf(north(0.05, 0, -3000), primary)).toEqual([])
  })

  it('ends a run where the variant cuts a corner the primary makes, though both ends are on it', () => {
    const bent = [...north(0, 0, -1000), { x: 10, z: -1500 }, ...north(0, -2000, -3000)]
    const runs = runsOf([...north(0, 0, -1000), ...north(0, -2000, -3000)], bent)
    expect(runs.map((r) => [r.v[0], r.v.at(-1)])).toEqual([
      [0, 1000],
      [2000, 3000],
    ])
  })
})

const profile = (...knots: [number, number][]): TrackProfile => ({
  d: Float64Array.from(knots, (k) => k[0]),
  y: Float64Array.from(knots, (k) => k[1]),
})
/** Slot and half-width with the same knots (a route joining a one-route corridor: half 0.5, slot ±0.5). */
const bands = (...knots: [number, number][]): ShapeBands => ({ slot: profile(...knots), half: profile(...knots) })
const knotsOf = (p: TrackProfile) => [...p.d].map((d, i) => [Math.round(d * 1e6) / 1e6, p.y[i]])
/** A run with variant distance v at primary distance v + offset. */
const run = (v0: number, v1: number, offset: number): SharedRun => ({ v: Float64Array.of(v0, v1), p: Float64Array.of(v0 + offset, v1 + offset) })

describe('shareBands', () => {
  it("takes the primary's knots, at the variant's distances, along a run between flat stretches where both agree", () => {
    // The variant's own taper is 15 m early (its sample grid), and it has one more outside the run.
    const own = bands([1500, 0], [1800, 0.5], [4000, 0.5], [4300, 0])
    const primary = bands([2015, 0], [2315, 0.5], [3600, 0.5], [3900, 0])
    const out = shareBands(own, primary, [run(1000, 3000, 500)], 5000)
    expect(knotsOf(out.slot)).toEqual([
      [1515, 0],
      [1815, 0.5],
      [4000, 0.5],
      [4300, 0],
    ])
    expect(knotsOf(out.half)).toEqual(knotsOf(out.slot))
  })

  it('hands over only where all four profiles are flat, keeping its own ease across a run start', () => {
    // Both ease across the run's start at 1000; the first flat stretch both agree on starts at 1315.
    const own = bands([800, 0], [1300, 0.5], [2000, 0.5], [2300, 0])
    const primary = bands([1315, 0], [1815, 0.5], [2515, 0.5], [2815, 0])
    const out = shareBands(own, primary, [run(1000, 3000, 500)], 5000)
    expect(knotsOf(out.slot)).toEqual([
      [800, 0],
      [1300, 0.5],
      [1315, 0.5],
      [2015, 0.5],
      [2315, 0],
    ])
  })

  it("takes the primary's from the variant's start on, mid-ease, when the run starts there (a short turn)", () => {
    const own = bands([100, 0], [400, 0.5])
    const primary = bands([1000, 0], [1300, 0.5])
    const out = shareBands(own, primary, [run(0, 2000, 1015)], 2000)
    expect(knotsOf(out.slot)).toEqual([
      [-15, 0],
      [285, 0.5],
    ])
  })

  it('keeps its own where it never agrees with the primary on a flat stretch', () => {
    const own = bands([0, 0.5])
    const primary = bands([0, -0.5])
    expect(shareBands(own, primary, [run(1000, 3000, 0)], 5000)).toBe(own)
  })

  it('becomes flat where it shares a band-free primary from end to end', () => {
    const out = shareBands(bands([100, 0], [400, 0.5]), { slot: EMPTY_PROFILE, half: EMPTY_PROFILE }, [run(0, 2000, 0)], 2000)
    expect(out).toEqual({ slot: EMPTY_PROFILE, half: EMPTY_PROFILE })
  })
})

describe('corridorBands with a variant on its primary', () => {
  it("gives a variant on the primary's track the primary's tapers, not its own sample grid's", () => {
    const shape = (id: string, routeId: string, primary: boolean, points: Ground[]): CorridorShape => ({
      id,
      routeId,
      direction: 'N',
      primary,
      line: buildPolyline(points),
    })
    // A's variant starts 15 m along A's primary, so its 30 m samples sit midway between the primary's.
    const shapes = [
      shape('a', 'A', true, north(0, 0, -3000)),
      shape('a2', 'A', false, [{ x: 0, z: -15 }, ...north(0, -100, -3000)]),
      shape('b', 'B', true, north(10, -1000, -2000)),
    ]
    const out = corridorBands(shapes, [
      { id: 'A', shortName: 'A' },
      { id: 'B', shortName: 'B' },
    ])
    const a = out.get('a')!
    const a2 = out.get('a2')!
    expect(a.slot.d.length).toBeGreaterThan(0)
    const shifted = (p: TrackProfile) => knotsOf({ d: p.d.map((d) => d - 15), y: p.y })
    expect(knotsOf(a2.slot)).toEqual(shifted(a.slot))
    expect(knotsOf(a2.half)).toEqual(shifted(a.half))
  })
})
