import { describe, expect, it } from 'vitest'
import { TtlLru } from './lru'

const memo = (body: string, expiresAt: number) => ({ body, expiresAt })

describe('TtlLru', () => {
  it('serves a fresh entry and drops an expired one', () => {
    const lru = new TtlLru(3)
    lru.set('a', memo('A', 100))
    expect(lru.get('a', 99)?.body).toBe('A')
    expect(lru.get('a', 100)).toBeNull()
    expect(lru.size).toBe(0)
    expect(lru.get('missing', 0)).toBeNull()
  })

  it('evicts the least recently used past the maximum, a get counting as use', () => {
    const lru = new TtlLru(2)
    lru.set('a', memo('A', 1000))
    lru.set('b', memo('B', 1000))
    lru.get('a', 0)
    lru.set('c', memo('C', 1000))
    expect(lru.get('b', 0)).toBeNull()
    expect(lru.get('a', 0)?.body).toBe('A')
    expect(lru.get('c', 0)?.body).toBe('C')
    expect(lru.size).toBe(2)
  })

  it('overwrites in place', () => {
    const lru = new TtlLru(2)
    lru.set('a', memo('one', 1000))
    lru.set('a', memo('two', 2000))
    expect(lru.size).toBe(1)
    expect(lru.get('a', 1500)?.body).toBe('two')
  })
})
