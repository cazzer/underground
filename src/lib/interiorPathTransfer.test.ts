/** The station path for a transfer, on the complex fixture: U01N (lower deck) up the direct stair st-tu to T01S. */
import { describe, expect, it } from 'vitest'
import { complexFixture } from './complexFixture'
import { interiorDecks, trainRoofY } from './interiorDecks'
import { BOARD_HALF_M, exitPathBuffers, exitPathCenterline, stationPathKey, type ExitPathOptions } from './interiorPath'
import type { Buffers } from './interiorSegments'
import { chooseTransfer, type TransferChoice } from './interiorTransfer'

const interior = complexFixture()
const RAIL_DROP = 1.1
const Y = 2

function transfer(fromStop = 'U01N', toStop = 'T01S'): TransferChoice {
  const r = chooseTransfer({ interior, fromStop, toStop })
  if (r.kind !== 'transfer') throw new Error(r.reason)
  return r
}

const opts = (over: Partial<ExitPathOptions> = {}): ExitPathOptions => ({
  yScale: Y,
  stepRise: 0.18,
  railDrop: RAIL_DROP,
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
}
const segs = (b: Buffers): Seg[] =>
  Array.from({ length: b.positions.length / 6 }, (_, k) => ({
    a: Array.from(b.positions.subarray(k * 6, k * 6 + 3)),
    b: Array.from(b.positions.subarray(k * 6 + 3, k * 6 + 6)),
  }))
const near = (a: number | undefined, b: number) => Math.abs(a! - b) < 1e-4
const len = (s: Seg) => Math.hypot(s.b[0]! - s.a[0]!, s.b[1]! - s.a[1]!, s.b[2]! - s.a[2]!)
/** Rail heights, drawn: T at -9, U at -14. */
const RAIL_T = (-9 - RAIL_DROP) * Y
const RAIL_U = (-14 - RAIL_DROP) * Y

describe('the transfer path', () => {
  const choice = transfer()

  it('runs from the U01N track up the stair and ends at platform height on the T01S track', () => {
    const line = exitPathCenterline(interior, choice, opts())
    expect(line.map((q) => [...q.p])).toEqual([
      [20, -28, 10.5],
      [20, -28, 11],
      [20, -18, 2],
      [20, -18, 2.5],
    ])
    expect(line.map((q) => q.level)).toEqual([3, 3, 2, 2])
  })

  it('marks both trains: the board marker on the U01N track and the end marker on the T01S track, at rail height', () => {
    const all = exitPathBuffers(interior, choice, opts()).bands.flatMap(segs)
    for (const [y, z] of [[RAIL_U, 10.5], [RAIL_T, 2.5]] as const) {
      const marker = all.filter((s) => near(s.a[1], y) && near(s.b[1], y) && near(s.a[2], z) && near(s.b[2], z))
      expect(marker.reduce((m, s) => m + len(s), 0), `marker at z ${z}`).toBeCloseTo(2 * BOARD_HALF_M, 4)
      expect(Math.min(...marker.flatMap((s) => [s.a[0]!, s.b[0]!]))).toBeCloseTo(20 - BOARD_HALF_M, 4)
    }
  })

  it('cuts the stair at the lower deck train roof: under it in band 0, over it in band 1', () => {
    const decks = interiorDecks(interior)
    expect(decks).toEqual([3, 2])
    const layers = exitPathBuffers(interior, choice, opts({ decks }))
    expect(layers.bands.length).toBe(3)
    const roof = trainRoofY(interior.levels[3]!, RAIL_DROP, Y)
    const [under, over] = [segs(layers.bands[0]!), segs(layers.bands[1]!)]
    expect(Math.max(...under.flatMap((s) => [s.a[1]!, s.b[1]!]))).toBeCloseTo(roof, 4)
    expect(over.some((s) => near(s.a[1], roof))).toBe(true)
    // The upper deck's walk to the track and its marker draw in band 1, over the lower deck's trains.
    expect(over.some((s) => near(s.a[1], RAIL_T))).toBe(true)
    expect(layers.bands[2]!.positions.length).toBe(0)
  })

  it('gives the level labels both markers to keep clear of', () => {
    const k = Array.from(exitPathBuffers(interior, choice, opts()).keepOut)
    // The first point, the stair foot, then three points of each marker.
    expect(k.length).toBe(3 * 8)
    const has = (p: number[]) => Array.from({ length: k.length / 3 }, (_, i) => k.slice(i * 3, i * 3 + 3)).some((q) => q.every((v, j) => near(v, p[j]!)))
    expect(has([20 - BOARD_HALF_M, RAIL_U, 10.5])).toBe(true)
    expect(has([20 + BOARD_HALF_M, RAIL_T, 2.5])).toBe(true)
  })

  it('restrokes the stair but draws no entrance square', () => {
    const plain = exitPathBuffers(interior, choice, opts()).bands.flatMap(segs)
    const restroked = exitPathBuffers(interior, choice, opts({ restroke: true })).bands.flatMap(segs)
    expect(restroked.length).toBeGreaterThan(plain.length)
    expect(restroked.some((s) => s.a[1] === 0 || s.b[1] === 0)).toBe(false)
  })

  it('throws for a change across one platform, which takes no connector', () => {
    expect(() => exitPathBuffers(interior, transfer('T01N', 'T01S'), opts())).toThrow('takes no connector')
  })

  it('keys its error boundary by stops and connectors', () => {
    expect(stationPathKey(choice)).toBe('U01N>T01S>st-tu')
  })
})
