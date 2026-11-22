import { describe, expect, it } from 'vitest'
import { MinHeap } from './minHeap'

function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

describe('MinHeap', () => {
  it('pops 1,000 seeded random keys in ascending order, growing past its capacity', () => {
    const rand = seeded(7)
    const heap = new MinHeap(4)
    const keys: number[] = []
    for (let i = 0; i < 1000; i++) {
      const k = rand() * 100
      keys.push(k)
      heap.push(i, k)
    }
    expect(heap.size).toBe(1000)
    const popped: number[] = []
    for (let i = 0; i < 1000; i++) {
      const item = heap.pop()
      popped.push(keys[item]!)
    }
    expect(popped).toEqual([...keys].sort((a, b) => a - b))
    expect(heap.size).toBe(0)
  })

  it('keeps duplicate items as separate entries', () => {
    const heap = new MinHeap()
    heap.push(7, 5)
    heap.push(8, 2)
    heap.push(7, 1)
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop()]).toEqual([7, 8, 7, -1])
  })

  it('pops -1 when empty', () => {
    const heap = new MinHeap()
    expect(heap.pop()).toBe(-1)
    heap.push(0, 1)
    heap.pop()
    expect(heap.pop()).toBe(-1)
  })
})
