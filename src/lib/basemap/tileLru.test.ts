import { describe, expect, it } from 'vitest'
import { createTileLru } from './tileLru'

describe('createTileLru', () => {
  it('evicts the least recently used first, by bytes', () => {
    const lru = createTileLru<{ bytes: number }>(100, 10)
    lru.set(1, { bytes: 40 })
    lru.set(2, { bytes: 40 })
    lru.set(3, { bytes: 40 })
    lru.touch(1)
    expect(lru.evict(() => false)).toEqual([2])
    expect(lru.bytes).toBe(80)
    expect(lru.has(1) && lru.has(3)).toBe(true)
  })

  it('evicts by count, counting empty tiles at 0 bytes', () => {
    const lru = createTileLru<{ bytes: number }>(100, 2)
    lru.set(1, { bytes: 0 })
    lru.set(2, { bytes: 0 })
    lru.set(3, { bytes: 0 })
    expect(lru.evict(() => false)).toEqual([1])
    expect(lru.size).toBe(2)
  })

  it('never evicts pinned keys, even over the limits', () => {
    const lru = createTileLru<{ bytes: number }>(10, 10)
    lru.set(1, { bytes: 20 })
    lru.set(2, { bytes: 20 })
    expect(lru.evict((k) => k === 1 || k === 2)).toEqual([])
    expect(lru.evict((k) => k === 2)).toEqual([1])
    expect(lru.bytes).toBe(20)
  })

  it('replaces an entry without double-counting it', () => {
    const lru = createTileLru<{ bytes: number }>()
    lru.set(1, { bytes: 5 })
    lru.set(1, { bytes: 7 })
    expect(lru.bytes).toBe(7)
    expect(lru.size).toBe(1)
    lru.clear()
    expect(lru.bytes + lru.size).toBe(0)
  })
})
