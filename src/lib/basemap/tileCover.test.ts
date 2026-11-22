import { describe, expect, it } from 'vitest'
import { drawnTiles } from './tileCover'
import { tileKey } from './tileMath'

describe('drawnTiles', () => {
  const a = tileKey(15, 100, 200)
  const b = tileKey(15, 101, 200)
  const parent = tileKey(14, 50, 100)
  const grand = tileKey(13, 25, 50)
  const kids = [tileKey(16, 200, 400), tileKey(16, 201, 400), tileKey(16, 200, 401), tileKey(16, 201, 401)]

  it('draws ready wanted tiles', () => {
    expect(drawnTiles([a, b], (k) => k === a || k === b, [])).toEqual([a, b])
  })

  it('falls back to the nearest ready ancestor, once', () => {
    expect(drawnTiles([a, b], (k) => k === parent || k === grand, [])).toEqual([parent])
    expect(drawnTiles([a], (k) => k === grand, [])).toEqual([grand])
  })

  it('keeps previous children that cover a wanted tile over a coarser cached ancestor', () => {
    expect(drawnTiles([a], (k) => kids.includes(k) || k === parent, kids)).toEqual(kids)
  })

  it('counts nested previous tiles once when checking cover', () => {
    const grandkid = tileKey(17, 400, 800)
    const drawn = [...kids, grandkid]
    expect(drawnTiles([a], (k) => drawn.includes(k) || k === parent, drawn)).toEqual(drawn)
    expect(drawnTiles([a], (k) => k === kids[0] || k === grandkid || k === parent, drawn)).toEqual([parent])
  })

  it('takes the ancestor over children that cover only part of it', () => {
    expect(drawnTiles([a], (k) => k === kids[0] || k === parent, kids)).toEqual([parent])
  })

  it('keeps partial previous children when there is no ancestor', () => {
    const elsewhere = tileKey(16, 0, 0)
    expect(drawnTiles([a], (k) => k === kids[0] || k === elsewhere, [kids[0]!, elsewhere])).toEqual([kids[0]])
  })

  it('draws nothing for a wanted tile with no ready cover', () => {
    expect(drawnTiles([a], () => false, [b])).toEqual([])
  })
})
