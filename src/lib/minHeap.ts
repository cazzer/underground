/**
 * A binary min-heap of (integer item, float key) pairs on growable typed arrays, for Dijkstra and A*. There is no
 * decrease-key: a caller pushes an item again with its better key and skips a popped item whose key is stale.
 */
export class MinHeap {
  private items: Int32Array
  private keys: Float64Array
  private count = 0

  constructor(capacity = 64) {
    this.items = new Int32Array(capacity)
    this.keys = new Float64Array(capacity)
  }

  get size(): number {
    return this.count
  }

  push(item: number, key: number): void {
    if (this.count === this.items.length) this.grow()
    let i = this.count++
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.keys[parent]! <= key) break
      this.items[i] = this.items[parent]!
      this.keys[i] = this.keys[parent]!
      i = parent
    }
    this.items[i] = item
    this.keys[i] = key
  }

  /** The item with the least key, or -1 when empty. */
  pop(): number {
    if (this.count === 0) return -1
    const top = this.items[0]!
    this.count--
    if (this.count > 0) {
      const item = this.items[this.count]!
      const key = this.keys[this.count]!
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= this.count) break
        if (child + 1 < this.count && this.keys[child + 1]! < this.keys[child]!) child++
        if (this.keys[child]! >= key) break
        this.items[i] = this.items[child]!
        this.keys[i] = this.keys[child]!
        i = child
      }
      this.items[i] = item
      this.keys[i] = key
    }
    return top
  }

  private grow(): void {
    const items = new Int32Array(this.items.length * 2)
    const keys = new Float64Array(this.keys.length * 2)
    items.set(this.items)
    keys.set(this.keys)
    this.items = items
    this.keys = keys
  }
}
