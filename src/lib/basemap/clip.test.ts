import { describe, expect, it } from 'vitest'
import { clipSegment, onTileEdge } from './clip'

const clip = (ax: number, ay: number, bx: number, by: number) => {
  const out = new Float64Array(4)
  return clipSegment(ax, ay, bx, by, 0, 4096, out) ? [...out] : null
}

describe('clipSegment', () => {
  it('keeps a segment inside', () => {
    expect(clip(10, 20, 30, 40)).toEqual([10, 20, 30, 40])
  })

  it('cuts a segment crossing an edge at the edge', () => {
    expect(clip(-100, 100, 100, 100)).toEqual([0, 100, 100, 100])
    expect(clip(4000, 4000, 4200, 4200)).toEqual([4000, 4000, 4096, 4096])
  })

  it('cuts a segment through the square at both ends', () => {
    expect(clip(-1000, 2048, 5000, 2048)).toEqual([0, 2048, 4096, 2048])
  })

  it('drops a segment wholly outside, including one in the buffer beside an edge', () => {
    expect(clip(-64, 10, -64, 4000)).toBeNull()
    expect(clip(-100, -10, 10, -100)).toBeNull()
    expect(clip(5000, 0, 5000, 100)).toBeNull()
  })
})

describe('onTileEdge', () => {
  it('finds a ring segment lying on an edge', () => {
    expect(onTileEdge(0, 10, 0.3, 4000, 0, 4096)).toBe(true)
    expect(onTileEdge(10, 4096, 3000, 4095.6, 0, 4096)).toBe(true)
  })

  it('keeps a segment that only touches or crosses an edge', () => {
    expect(onTileEdge(0, 10, 50, 4000, 0, 4096)).toBe(false)
    expect(onTileEdge(0, 0, 4096, 4096, 0, 4096)).toBe(false)
  })
})
