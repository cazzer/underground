import { Color, type InterleavedBufferAttribute } from 'three'
import { describe, expect, it } from 'vitest'
import { planPool } from '../lib/basemap/tilePool'
import { createClassLayer, INITIAL_SEGMENTS, type ClassLayer } from './basemapLayer'
import { createMaskUniforms } from './basemapLineMaterial'

/** `n` segments whose every float is `tag`, so the buffer shows which tile wrote where. */
const segs = (n: number, tag: number) => new Float32Array(n * 6).fill(tag)

function buffer(layer: ClassLayer) {
  return (layer.line.geometry.getAttribute('instanceStart') as InterleavedBufferAttribute).data
}

/** Applies `drawn` after `prev` (as Basemap does) and returns the new order. */
function step(layer: ClassLayer, prev: number[], drawn: number[], tiles: Map<number, Float32Array>): number[] {
  const plan = planPool(prev, drawn)
  layer.apply(plan.order, plan.keep, (k) => tiles.get(k))
  return plan.order
}

describe('createClassLayer', () => {
  it('is a transparent overlay that neither tests nor writes depth, masked or not', () => {
    for (const mask of [createMaskUniforms(), null]) {
      const { line } = createClassLayer({ width: 1, renderOrder: 0.4, mask })
      expect(line.material.transparent).toBe(true)
      expect(line.material.depthTest).toBe(false)
      expect(line.material.depthWrite).toBe(false)
      expect(line.renderOrder).toBe(0.4)
      expect(line.frustumCulled).toBe(false)
    }
  })

  it('writes only from the first moved tile and uploads only that range', () => {
    const layer = createClassLayer({ width: 1, renderOrder: 0, mask: null })
    const tiles = new Map([[1, segs(2, 1)], [2, segs(3, 2)], [3, segs(1, 3)], [4, segs(2, 4)]])
    let order = step(layer, [], [1, 2, 3], tiles)
    expect(layer.used).toBe(6)
    expect(layer.line.geometry.instanceCount).toBe(6)
    // Tile 2 goes, 4 comes: tile 1 stays put, 3 moves down, 4 appends.
    buffer(layer).clearUpdateRanges()
    order = step(layer, order, [1, 3, 4], tiles)
    expect(order).toEqual([1, 3, 4])
    expect(layer.used).toBe(5)
    const a = buffer(layer).array as Float32Array
    expect([a[0], a[11], a[12], a[17], a[18], a[29]]).toEqual([1, 1, 3, 3, 4, 4])
    expect(buffer(layer).updateRanges).toEqual([{ start: 12, count: 18 }])
  })

  it('widens a range not yet uploaded instead of dropping it', () => {
    const layer = createClassLayer({ width: 1, renderOrder: 0, mask: null })
    const tiles = new Map([[1, segs(2, 1)], [2, segs(3, 2)], [3, segs(1, 3)]])
    let order = step(layer, [], [1], tiles)
    order = step(layer, order, [1, 2], tiles)
    step(layer, order, [1, 2, 3], tiles)
    expect(buffer(layer).updateRanges).toEqual([{ start: 0, count: 36 }])
  })

  it('grows to the next power of two of 1.25x the need, keeping the prefix', () => {
    const layer = createClassLayer({ width: 1, renderOrder: 0, mask: null })
    const tiles = new Map([[1, segs(1000, 1)], [2, segs(1000, 2)]])
    const order = step(layer, [], [1], tiles)
    const first = layer.line.geometry
    expect(layer.capacity).toBe(INITIAL_SEGMENTS)
    step(layer, order, [1, 2], tiles)
    expect(layer.capacity).toBe(4096)
    expect(layer.line.geometry).not.toBe(first)
    const a = buffer(layer).array as Float32Array
    expect([a[0], a[5999], a[6000], a[11999], a[12000]]).toEqual([1, 1, 2, 2, 0])
  })

  it('draws only with segments and a strength above 0, mixing toward the background', () => {
    const layer = createClassLayer({ width: 1, renderOrder: 0, mask: null })
    const stroke = new Color(1, 1, 1)
    const bg = new Color(0, 0, 0)
    layer.setVisibility(0.5, stroke, bg)
    expect(layer.line.visible).toBe(false)
    step(layer, [], [1], new Map([[1, segs(1, 1)]]))
    expect(layer.line.visible).toBe(true)
    expect(layer.line.material.color.r).toBeCloseTo(0.5, 12)
    layer.setVisibility(0, stroke, bg)
    expect(layer.line.visible).toBe(false)
  })
})
