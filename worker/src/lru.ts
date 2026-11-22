import type { Memo } from './cache'

/** A bounded map of bodies with expiry; the least recently used entry goes first. Per isolate, resolved values only. */
export class TtlLru {
  private readonly entries = new Map<string, Memo>()

  constructor(private readonly maxEntries: number) {}

  get size(): number {
    return this.entries.size
  }

  get(key: string, now: number): Memo | null {
    const memo = this.entries.get(key)
    if (!memo) return null
    this.entries.delete(key)
    if (memo.expiresAt <= now) return null
    // Re-inserted: a Map iterates in insertion order, so the oldest key is the least recently used.
    this.entries.set(key, memo)
    return memo
  }

  set(key: string, memo: Memo): void {
    this.entries.delete(key)
    this.entries.set(key, memo)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
  }
}
