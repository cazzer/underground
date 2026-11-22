import { describe, expect, it } from 'vitest'
import { compactTies, focusedTie, STUB_DEPTH_M } from './stationTie'

describe('focusedTie', () => {
  it('drops the tie of a station its interior marks, whether or not it has a depth', () => {
    expect(focusedTie(true, false)).toBe('drop')
    expect(focusedTie(false, false)).toBe('drop')
  })
  it('keeps a fallback station tie to its track depth', () => {
    expect(focusedTie(true, true)).toBe('keep')
  })
  it('gives a fallback station with no depth a stub', () => {
    expect(focusedTie(false, true)).toBe('stub')
  })
  it('keeps the stub short', () => {
    expect(STUB_DEPTH_M).toBeGreaterThan(0)
    expect(STUB_DEPTH_M).toBeLessThan(30)
  })
})

describe('compactTies', () => {
  /** Four ties whose six floats are all their index. */
  const ties = () => Float32Array.from({ length: 24 }, (_, k) => Math.floor(k / 6))
  const drawn = (buf: Float32Array, n: number) => Array.from({ length: n }, (_, i) => buf[i * 6]!)

  it('keeps every tie when none is dropped', () => {
    const buf = ties()
    expect(compactTies(buf, 4, new Set())).toBe(4)
    expect(drawn(buf, 4)).toEqual([0, 1, 2, 3])
  })

  it('closes the gap a dropped tie leaves, keeping the order', () => {
    const buf = ties()
    const n = compactTies(buf, 4, new Set([1]))
    expect(n).toBe(3)
    expect(drawn(buf, n)).toEqual([0, 2, 3])
    expect([...buf.subarray(6, 12)]).toEqual(new Array(6).fill(2))
  })

  it('drops several, including the last slot and adjacent ones, without ever drawing a dropped tie', () => {
    for (const dropped of [[3], [2, 3], [0, 1], [0, 3], [1, 2], [0, 1, 2, 3]]) {
      const buf = ties()
      const n = compactTies(buf, 4, new Set(dropped))
      expect(n).toBe(4 - dropped.length)
      expect(drawn(buf, n)).toEqual([0, 1, 2, 3].filter((k) => !dropped.includes(k)))
    }
  })

  it('leaves slots past the real ties alone, and ignores a dropped index past them', () => {
    const buf = new Float32Array(30).fill(9)
    for (let k = 0; k < 24; k++) buf[k] = Math.floor(k / 6)
    expect(compactTies(buf, 4, new Set([1, 7]))).toBe(3)
    expect([...buf.subarray(24)]).toEqual(new Array(6).fill(9))
  })
})
