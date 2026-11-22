import { describe, expect, it } from 'vitest'
import { buildStopIndex } from './stops'
import { CUT_SLACK_S, findRun, nearestRow, predictedRun, rowOnPattern } from './overlayRows'
import type { Row } from './overlayGroups'

const index = buildStopIndex({ stopIds: ['101N', '102N', '103N', '104N'], changeS: new Map(), transfers: [] })
const stop = (id: string) => index.stopOf.get(id)!

describe('predictedRun', () => {
  it('drops an unknown stop and raises a backward time', () => {
    const r = predictedRun(
      [['101N', 1500], ['999N', 1560], ['102N', 1480], ['103N', 1700]],
      index,
      1000,
    )
    expect([...r.stops]).toEqual([stop('101N'), stop('102N'), stop('103N')])
    expect([...r.times]).toEqual([500, 500, 700])
    expect(r.clamped).toBe(true)
    expect(r.dropped).toBe(1)
  })

  it('leaves an ordered run alone', () => {
    const r = predictedRun([['101N', 10], ['102N', 10]], index, 0)
    expect(r).toMatchObject({ clamped: false, dropped: 0 })
  })
})

describe('findRun', () => {
  const stops = Int32Array.from([1, 2, 3, 4])
  it('finds a consecutive run', () => expect(findRun(stops, Int32Array.from([2, 3]))).toBe(1))
  it('rejects a gap', () => expect(findRun(stops, Int32Array.from([1, 3]))).toBe(-1))
  it('rejects a run longer than the pattern or an empty one', () => {
    expect(findRun(stops, Int32Array.from([3, 4, 5]))).toBe(-1)
    expect(findRun(stops, new Int32Array(0))).toBe(-1)
  })
  it('tries every occurrence of the first stop', () => {
    expect(findRun(Int32Array.from([1, 2, 1, 3]), Int32Array.from([1, 3]))).toBe(2)
  })
})

describe('nearestRow', () => {
  const mk = (id: string, t: number, removed = false) => ({ id, arr: [0, t], dep: [0, t], removed }) as unknown as Row
  it('takes the nearest row, removed or not, the first of equals', () => {
    const rows = [mk('a', 100), mk('b', 190, true), mk('c', 200), mk('d', 300)]
    expect(nearestRow(rows, 1, 195)?.id).toBe('b')
    expect(nearestRow(rows, 1, 250)?.id).toBe('c')
    expect(nearestRow([mk('x', 1, true)], 1, 0)?.id).toBe('x')
    expect(nearestRow([], 1, 0)).toBeNull()
  })
})

describe('rowOnPattern', () => {
  const NOW_DAY = 10_000
  const bounds = { nowDay: NOW_DAY, horizonDay: NOW_DAY + 1800 }
  // 120 s runs; a 30 s dwell at position 2.
  const ref = { arr: [9000, 9120, 9270, 9390], dep: [9000, 9120, 9300, 9390] }
  const run = (...times: number[]) => ({ stops: Int32Array.from(times.map((_, i) => i)), times: Int32Array.from(times) })

  it('backfills passed stops no later than one second before now', () => {
    const full = rowOnPattern(3, 1, run(NOW_DAY + 200, NOW_DAY + 320), { arr: [9000, 9120, 9270], dep: [9000, 9120, 9270] }, bounds)!
    // Unclamped, stop 0 would be t0 - 120 = NOW_DAY + 80.
    expect(full.arr[0]).toBe(NOW_DAY - 1)
    expect(full.dep[0]).toBe(NOW_DAY - 1)
    expect([...full.arr.subarray(1)]).toEqual([NOW_DAY + 200, NOW_DAY + 320])
  })

  it('keeps times in order when the first prediction is already past', () => {
    const r = rowOnPattern(3, 1, run(NOW_DAY - 30, NOW_DAY + 60), { arr: [9000, 9120, 9270], dep: [9000, 9120, 9270] }, bounds)!
    expect(r.arr[0]).toBe(NOW_DAY - 150) // the run time before it, not capped: it is before now
    for (let i = 1; i < 3; i++) expect(r.arr[i]!).toBeGreaterThanOrEqual(r.dep[i - 1]!)
  })

  it('is a short turn when the run ends well before the horizon', () => {
    expect(rowOnPattern(3, 0, run(NOW_DAY + 100, NOW_DAY + 300), { arr: [0, 120, 270], dep: [0, 150, 270] }, bounds)).toBeNull()
  })

  it('continues on the scheduled run times when the predictions stop at the horizon, keeping the dwell', () => {
    const last = bounds.horizonDay - CUT_SLACK_S / 2
    const r = rowOnPattern(4, 0, run(last - 120, last), ref, bounds)!
    expect(r.extended).toBe(true)
    const shift = last - 9120
    expect([...r.arr]).toEqual([last - 120, last, 9270 + shift, 9390 + shift])
    expect([...r.dep]).toEqual([last - 120, last, 9300 + shift, 9390 + shift])
  })

  it('has no tail when the run reaches the last stop', () => {
    const r = rowOnPattern(2, 0, run(NOW_DAY + 10, NOW_DAY + 100), { arr: [0, 90], dep: [0, 90] }, bounds)!
    expect(r.extended).toBe(false)
  })
})
