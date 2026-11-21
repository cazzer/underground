import { describe, expect, it, vi } from 'vitest'
import { createInteriorCache } from './interiorCache'

describe('createInteriorCache', () => {
  it('shares one load between concurrent gets', async () => {
    const load = vi.fn((id: string) => Promise.resolve(`model ${id}`))
    const cache = createInteriorCache(load)
    const a = cache.get('L08')
    const b = cache.get('L08')
    expect(a).toBe(b)
    await expect(a).resolves.toBe('model L08')
    await cache.get('L08')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads again after a rejection', async () => {
    const load = vi
      .fn<(id: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce('model')
    const cache = createInteriorCache(load)
    await expect(cache.get('L08')).rejects.toThrow('HTTP 500')
    expect(cache.peek('L08')).toBeUndefined()
    await expect(cache.get('L08')).resolves.toBe('model')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('peeks undefined until the load resolves, then the value', async () => {
    let resolve!: (v: string) => void
    const cache = createInteriorCache(() => new Promise<string>((r) => (resolve = r)))
    const p = cache.get('L08')
    expect(cache.peek('L08')).toBeUndefined()
    resolve('model')
    await p
    expect(cache.peek('L08')).toBe('model')
    expect(cache.peek('L06')).toBeUndefined()
  })
})
