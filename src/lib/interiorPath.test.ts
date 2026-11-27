import { describe, expect, it } from 'vitest'
import type { Connector, StationInterior } from '../data/stationSchema'
import { quickestExit, type ExitChoice } from './exitChoice'
import { interiorDecks, trainRoofY } from './interiorDecks'
import { connectorContext } from './interiorGeometry'
import { planEnds } from './interiorConnectors'
import { fixture } from './interiorFixture'
import { BOARD_HALF_M, exitPathBuffers, exitPathCenterline, type ExitPathOptions } from './interiorPath'
import type { Buffers } from './interiorSegments'
import { toGround } from './projection'

const sources: Connector['sources'] = ['authored']
const stair = (id: string, lower: [number, number, string], upper: [number, number, string]): Connector => ({
  id,
  kind: 'stair',
  lower: { x: lower[0], z: lower[1], level: lower[2] },
  upper: { x: upper[0], z: upper[1], level: upper[2] },
  width: 2,
  sources,
})
const PS1 = stair('PS1', [-10, 2, 'plat'], [-10, 8, 'mezz'])
const ST1 = stair('ST1', [0, 10, 'mezz'], [7, 10, 'street'])

/** Platform stair PS1 up to a wide mezzanine, ST1 out to the street at E1 (9, 10). */
function station(connectors: Connector[] = [PS1, ST1], over: Partial<StationInterior> = {}): StationInterior {
  const base = fixture(connectors)
  return { ...base, slabs: [{ ...base.slabs[0]!, outline: [[-15, 2], [15, 2], [15, 15], [-15, 15]] }], ...over }
}

function exitOf(interior: StationInterior): ExitChoice {
  const r = quickestExit({ interior, stopId: 'X01N' })
  if (r.kind !== 'exit') throw new Error(`no exit: ${r.reason}`)
  return r
}

const opts = (over: Partial<ExitPathOptions> = {}): ExitPathOptions => ({
  yScale: 2,
  stepRise: 0.18,
  railDrop: 1.1,
  entranceSize: 2.5,
  decks: [],
  rgb: [1, 0, 0.5],
  dashInStation: false,
  restroke: false,
  boardHalfM: BOARD_HALF_M,
  ...over,
})

interface Seg {
  a: number[]
  b: number[]
  d: [number, number]
}
function segs(b: Buffers): Seg[] {
  return Array.from({ length: b.positions.length / 6 }, (_, k) => ({
    a: Array.from(b.positions.subarray(k * 6, k * 6 + 3)),
    b: Array.from(b.positions.subarray(k * 6 + 3, k * 6 + 6)),
    d: [b.distances[k * 2]!, b.distances[k * 2 + 1]!],
  }))
}
const len = (s: Seg) => Math.hypot(s.b[0]! - s.a[0]!, s.b[1]! - s.a[1]!, s.b[2]! - s.a[2]!)
const total = (list: Seg[]) => list.reduce((m, s) => m + len(s), 0)
const RAIL_Y = (-8 - 1.1) * 2
/** Buffers are float32. */
const near = (a: number | undefined, b: number) => Math.abs(a! - b) < 1e-4

describe('exitPathCenterline', () => {
  const interior = station()
  const line = exitPathCenterline(interior, exitOf(interior), opts())

  it('starts at platform height over the track point and runs each connector to the exit at the street', () => {
    expect(line.map((q) => [...q.p])).toEqual([
      [-10, -16, -5],
      [-10, -16, 2],
      [-10, -8, 8],
      [0, -8, 10],
      [7, 0, 10],
      [9, 0, 10],
    ])
    expect(line.map((q) => q.level)).toEqual([2, 2, 1, 1, 0, 0])
  })

  it('rises straight up an elevator shaft', () => {
    const el: Connector = { id: 'EL1', kind: 'elevator', lower: { x: 3, z: 2.5, level: 'plat' }, upper: { x: 3, z: 2.5, level: 'mezz' }, width: 2, sources }
    const i = station([el, ST1])
    const pts = exitPathCenterline(i, exitOf(i), opts()).map((q) => [...q.p])
    expect(pts.slice(1, 3)).toEqual([
      [3, -16, 2.5],
      [3, -8, 2.5],
    ])
  })

  it('takes a zero-run escalator along the run it is drawn with', () => {
    const es: Connector = { id: 'ES1', kind: 'escalator', lower: { x: -10, z: 2, level: 'plat' }, upper: { x: -10, z: 2, level: 'mezz' }, width: 1.5, sources }
    const i = station([es, ST1])
    const ends = planEnds(connectorContext(i, { yScale: 2, stepRise: 0.18, colorOf: () => [0, 0, 0] }), es, 2, 1)
    const pts = exitPathCenterline(i, exitOf(i), opts()).map((q) => [...q.p])
    expect(pts[1]).toEqual([ends.lower[0], -16, ends.lower[1]])
    expect(pts[2]).toEqual([ends.upper[0], -8, ends.upper[1]])
    expect(Math.hypot(ends.upper[0] - ends.lower[0], ends.upper[1] - ends.lower[1])).toBeCloseTo(4 * Math.sqrt(3), 9)
  })

  it('crosses a walkway from one mezzanine to the other, in travel order', () => {
    const ww: Connector = { id: 'WW1', kind: 'walkway', lower: { x: 0, z: 10, level: 'mezz', area: 'S1' }, upper: { x: 5, z: 10, level: 'mezz', area: 'S2' }, width: 3, sources }
    const out = stair('ST1', [8, 10, 'mezz'], [12, 10, 'street'])
    const base = station([PS1, ww, out])
    const slab = base.slabs[0]!
    const i: StationInterior = {
      ...base,
      slabs: [
        { ...slab, id: 'S1', outline: [[-15, 2], [0, 2], [0, 15], [-15, 15]] },
        { ...slab, id: 'S2', outline: [[5, 2], [15, 2], [15, 15], [5, 15]] },
      ],
      entrances: [{ ...base.entrances[0]!, x: 14, z: 10 }],
    }
    const choice = exitOf(i)
    expect(choice.connectorIds).toEqual(['PS1', 'WW1', 'ST1'])
    const pts = exitPathCenterline(i, choice, opts()).map((q) => [...q.p])
    expect(pts.slice(3, 6)).toEqual([
      [0, -8, 10],
      [5, -8, 10],
      [8, -8, 10],
    ])
    expect(pts.at(-1)).toEqual([14, 0, 10])
    // Restroked, a walkway's sides dash as the interior's do (on an estimated layout), each from 0.
    const sides = (j: StationInterior) => {
      const l = exitPathBuffers(j, exitOf(j), opts({ restroke: true }))
      return { dashed: l.dashed, own: segs(l.bands[0]!).filter((q) => q.d[0] === 0 && q.d[1] > 0 && q.a[1] === -8 && q.b[1] === -8) }
    }
    expect(sides(i)).toEqual({ dashed: false, own: [] })
    const estimated = sides({ ...i, generated: { archetype: 'cut-cover-mezzanine', confidence: 0.9 } })
    expect(estimated.dashed).toBe(true)
    expect(estimated.own.length).toBe(2)
  })
})

describe('exitPathBuffers', () => {
  const interior = station()
  const choice = exitOf(interior)
  const decks = interiorDecks(interior)
  const centerLength = (() => {
    const pts = exitPathCenterline(interior, choice, opts()).map((q) => q.p)
    return pts.slice(1).reduce((m, p, k) => m + Math.hypot(p[0] - pts[k]![0], p[1] - pts[k]![1], p[2] - pts[k]![2]), 0)
  })()

  it('cuts the platform stair at the trains roof: the platform and the stair foot under, the rest over', () => {
    const layers = exitPathBuffers(interior, choice, opts({ decks }))
    const roof = trainRoofY(interior.levels[decks[0]!]!, 1.1, 2)
    const under = segs(layers.bands[0]!)
    const over = segs(layers.bands[1]!)
    expect(under.some((s) => near(s.b[1], roof))).toBe(true)
    expect(over.some((s) => near(s.a[1], roof))).toBe(true)
    expect(Math.max(...under.flatMap((s) => [s.a[1]!, s.b[1]!]))).toBeCloseTo(roof, 4)
    expect(Math.min(...over.flatMap((s) => [s.a[1]!, s.b[1]!]))).toBeCloseTo(roof, 4)
    // The mezzanine walk and the street end are over the trains.
    expect(over.some((s) => s.a[1] === -8 && s.b[1] === -8)).toBe(true)
    expect(over.some((s) => s.b[0] === 9 && s.b[1] === 0)).toBe(true)
    expect(total(under) + total(over)).toBeCloseTo(centerLength + 2 * BOARD_HALF_M, 6)
    expect(layers.dashed).toBe(false)
  })

  it('gives the level labels the path start to keep clear of: first point, first connector foot, board marker', () => {
    const k = Array.from(exitPathBuffers(interior, choice, opts()).keepOut)
    expect(k.slice(0, 6)).toEqual([-10, -16, -5, -10, -16, 2])
    expect(k.length).toBe(15)
    expect(k[7]).toBeCloseTo(RAIL_Y, 4)
  })

  it('draws everything under at an elevated station', () => {
    const elevated = station([stair('PS1', [-10, 8, 'mezz'], [-10, 2, 'plat']), stair('ST1', [7, 10, 'street'], [0, 10, 'mezz'])], {
      levels: [
        { id: 'plat', name: 'Platform', kind: 'platform', y: 8 },
        { id: 'mezz', name: 'Mezzanine', kind: 'mezzanine', y: 4 },
        { id: 'street', name: 'Street', kind: 'street', y: 0 },
      ],
    })
    const c = exitOf(elevated)
    const layers = exitPathBuffers(elevated, c, opts({ decks: interiorDecks(elevated) }))
    expect(layers.bands[1]!.positions.length).toBe(0)
    const pts = exitPathCenterline(elevated, c, opts()).map((q) => [...q.p])
    expect(pts[0]).toEqual([-10, 16, -5])
    expect(pts.at(-1)).toEqual([9, 0, 10])
  })

  it('carries one dash phase along the path, across the roof cut; solid without dashing and on the restroke', () => {
    const dashed = exitPathBuffers(interior, choice, opts({ decks, dashInStation: true }))
    expect(dashed.dashed).toBe(true)
    const all = [...segs(dashed.bands[0]!), ...segs(dashed.bands[1]!)].sort((p, q) => p.d[0] - q.d[0])
    expect(all[0]!.d[0]).toBe(0)
    for (let k = 0; k < all.length; k++) {
      expect(all[k]!.d[1] - all[k]!.d[0]).toBeCloseTo(len(all[k]!), 4)
      if (k > 0) expect(all[k]!.d[0]).toBeCloseTo(all[k - 1]!.d[1], 4)
    }
    const solid = exitPathBuffers(interior, choice, opts({ decks }))
    expect([...solid.bands[0]!.distances, ...solid.bands[1]!.distances].every((d) => d === 0)).toBe(true)
    const restroked = exitPathBuffers(interior, choice, opts({ decks, dashInStation: true, restroke: true }))
    const moving = [...segs(restroked.bands[0]!), ...segs(restroked.bands[1]!)].filter((s) => s.d[1] !== 0)
    expect(moving.length).toBe(all.length)
    expect(restroked.bands[0]!.positions.length + restroked.bands[1]!.positions.length).toBeGreaterThan(dashed.bands[0]!.positions.length + dashed.bands[1]!.positions.length)
  })

  it('marks the board point: track at rail height, two half-lengths long, kept on the track at its ends', () => {
    const marker = segs(exitPathBuffers(interior, choice, opts()).bands[0]!).filter((s) => near(s.a[1], RAIL_Y) && near(s.b[1], RAIL_Y))
    expect(total(marker)).toBeCloseTo(2 * BOARD_HALF_M, 4)
    expect(marker.every((s) => s.a[2] === -5 && s.b[2] === -5)).toBe(true)
    expect(Math.min(...marker.flatMap((s) => [s.a[0]!, s.b[0]!]))).toBeCloseTo(-10 - BOARD_HALF_M, 4)
    const nearEnd = station([stair('PS1', [-19, 2, 'plat'], [-10, 8, 'mezz']), ST1])
    const clamped = segs(exitPathBuffers(nearEnd, exitOf(nearEnd), opts()).bands[0]!).filter((s) => near(s.a[1], RAIL_Y))
    expect(total(clamped)).toBeCloseTo(2 * BOARD_HALF_M, 4)
    expect(Math.min(...clamped.flatMap((s) => [s.a[0]!, s.b[0]!]))).toBeCloseTo(-25, 4)
  })

  it('draws no walk outside the station, whatever the choice carries: the map\'s dashed walk is the only drawing of it', () => {
    const o = toGround(interior.anchor)
    const at = (x: number, z: number) => ({ x: o.x + x, z: o.z + z })
    const bare = exitPathBuffers(interior, choice, opts({ decks }))
    const routed: ExitChoice = { ...choice, destination: at(50, 20), walk: { kind: 'route', points: [at(9, 10), at(9, 20), at(50, 20)], meters: 51, seconds: 40 } }
    const estimated: ExitChoice = { ...choice, destination: at(100, 0), walk: { kind: 'estimate', meters: 91.5, seconds: 90 } }
    for (const walked of [routed, estimated]) {
      const layers = exitPathBuffers(interior, walked, opts({ decks }))
      expect(layers.bands.map((b) => [...b.positions])).toEqual(bare.bands.map((b) => [...b.positions]))
      expect(layers.dashed).toBe(false)
    }
  })
})
