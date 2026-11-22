/** Decoded tiles by key, least recently used first out, bounded by bytes and count; pinned keys are never evicted. */

export interface Sized {
  bytes: number
}

/** About 24 MB of decoded buffers. */
export const LRU_MAX_BYTES = 24 * 1024 * 1024
export const LRU_MAX_ENTRIES = 128

export interface TileLru<T extends Sized> {
  has(key: number): boolean
  /** Reads without touching. */
  peek(key: number): T | undefined
  /** Marks the key most recently used. */
  touch(key: number): void
  set(key: number, value: T): void
  /** Evicts unpinned entries, oldest first, until within both limits; returns the evicted keys. */
  evict(pinned: (key: number) => boolean): number[]
  clear(): void
  readonly size: number
  readonly bytes: number
}

export function createTileLru<T extends Sized>(maxBytes = LRU_MAX_BYTES, maxEntries = LRU_MAX_ENTRIES): TileLru<T> {
  const map = new Map<number, T>()
  let bytes = 0
  return {
    has: (key) => map.has(key),
    peek: (key) => map.get(key),
    touch(key) {
      const v = map.get(key)
      if (v === undefined) return
      map.delete(key)
      map.set(key, v)
    },
    set(key, value) {
      const old = map.get(key)
      if (old !== undefined) {
        bytes -= old.bytes
        map.delete(key)
      }
      map.set(key, value)
      bytes += value.bytes
    },
    evict(pinned) {
      const evicted: number[] = []
      for (const [key, v] of map) {
        if (bytes <= maxBytes && map.size <= maxEntries) break
        if (pinned(key)) continue
        map.delete(key)
        bytes -= v.bytes
        evicted.push(key)
      }
      return evicted
    },
    clear() {
      map.clear()
      bytes = 0
    },
    get size() {
      return map.size
    },
    get bytes() {
      return bytes
    },
  }
}
