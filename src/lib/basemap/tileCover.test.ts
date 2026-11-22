import { describe, expect, it } from 'vitest'
import { drawnTiles } from './tileCover'
import { tileKey } from './tileMath'

describe('drawnTiles', () => {
  const a = tileKey(15, 100, 200)
  const b = tileKey(15, 101, 200)
  const parent = tileKey(14, 50, 100)
  const grand = tileKey(13, 25, 50)

  it('draws ready wanted tiles', () => {
    expect(drawnTiles([a, b], (k) => k === a || k === b, [])).toEqual([a, b])
  })

  it('falls back to the nearest ready ancestor, once', () => {
    expect(drawnTiles([a, b], (k) => k === parent || k === grand, [])).toEqual([parent])
    expect(drawnTiles([a], (k) => k === grand, [])).toEqual([grand])
  })

  it('keeps the previous children of a wanted tile while it loads', () => {
    const kids = [tileKey(16, 200, 400), tileKey(16, 201, 401)]
    const elsewhere = tileKey(16, 0, 0)
    expect(drawnTiles([a], (k) => kids.includes(k) || k === elsewhere, [...kids, elsewhere])).toEqual(kids)
  })

  it('draws nothing for a wanted tile with no ready cover', () => {
    expect(drawnTiles([a], () => false, [b])).toEqual([])
  })
})
