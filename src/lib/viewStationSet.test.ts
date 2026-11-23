import { describe, expect, it, vi } from 'vitest'
import { createViewStationSet } from './viewStationSet'

describe('createViewStationSet', () => {
  it('starts empty, holds the last list and tells each listener on every set', () => {
    const store = createViewStationSet()
    expect(store.get()).toEqual([])
    const seen: (readonly string[])[] = []
    const off = store.subscribe((ids) => seen.push(ids))
    const ids = ['A', 'B']
    store.set(ids)
    expect(store.get()).toBe(ids)
    off()
    store.set([])
    expect(seen).toEqual([['A', 'B']])
  })
  it('isolates a listener that throws', () => {
    const store = createViewStationSet()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen: (readonly string[])[] = []
    store.subscribe(() => {
      throw new Error('bad')
    })
    store.subscribe((ids) => seen.push(ids))
    store.set(['A'])
    expect(seen).toEqual([['A']])
    expect(err).toHaveBeenCalledTimes(1)
    err.mockRestore()
  })
})
