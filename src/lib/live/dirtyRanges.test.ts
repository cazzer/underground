import { describe, expect, it } from 'vitest'
import { createRangePool, pushDirtyRanges, type UpdateRange } from './dirtyRanges'

describe('pushDirtyRanges', () => {
  it('merges runs of dirty slots into one range each', () => {
    const dirty = Uint8Array.from([1, 1, 0, 0, 1, 0, 1, 1, 1, 0])
    const out: UpdateRange[] = []
    const n = pushDirtyRanges(dirty, dirty.length, 10, 0, createRangePool(5), out)
    expect(n).toBe(3)
    expect(out).toEqual([
      { start: 0, count: 20 },
      { start: 40, count: 10 },
      { start: 60, count: 30 },
    ])
  })

  it('bridges short clean gaps but not long ones', () => {
    const dirty = Uint8Array.from([1, 0, 0, 1, 0, 0, 0, 0, 1, 0])
    const out: UpdateRange[] = []
    expect(pushDirtyRanges(dirty, dirty.length, 1, 2, createRangePool(5), out)).toBe(2)
    expect(out).toEqual([
      { start: 0, count: 4 },
      { start: 8, count: 1 },
    ])
  })

  it('stops at high and appends nothing when nothing is dirty', () => {
    const out: UpdateRange[] = []
    expect(pushDirtyRanges(Uint8Array.from([0, 0, 1, 1]), 2, 16, 4, createRangePool(1), out)).toBe(0)
    expect(out).toEqual([])
    expect(pushDirtyRanges(Uint8Array.from([0, 1, 1, 1]), 3, 16, 4, createRangePool(2), out)).toBe(1)
    expect(out).toEqual([{ start: 16, count: 32 }])
  })

  it('reuses pool objects instead of allocating', () => {
    const pool = createRangePool(2)
    const out: UpdateRange[] = []
    pushDirtyRanges(Uint8Array.from([1, 0, 1]), 3, 1, 0, pool, out)
    expect(out[0]).toBe(pool[0])
    expect(out[1]).toBe(pool[1])
  })
})
