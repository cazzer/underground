import { describe, expect, it } from 'vitest'
import {
  bboxTileRange,
  isDescendant,
  keyX,
  keyY,
  keyZ,
  latToTileY,
  lonToTileX,
  metersPerPixel,
  MIN_Z,
  parentKey,
  tileKey,
  tileWidthM,
  tileXToLon,
  tileYToLat,
  zoomFor,
} from './tileMath'

const NYC: [number, number, number, number] = [-74.2591, 40.4774, -73.7004, 40.9176]

describe('tileMath', () => {
  it('round-trips lon/lat through tile coordinates', () => {
    for (const [lon, lat] of [[-74.006, 40.7128], [-73.7004, 40.9176], [0, 0], [179.9, -84]] as const) {
      for (const z of [0, 9, 15]) {
        expect(tileXToLon(lonToTileX(lon, z), z)).toBeCloseTo(lon, 9)
        expect(tileYToLat(latToTileY(lat, z), z)).toBeCloseTo(lat, 9)
      }
    }
  })

  it('puts City Hall in z15 tile 9647/12320', () => {
    expect(Math.floor(lonToTileX(-74.006, 15))).toBe(9647)
    expect(Math.floor(latToTileY(40.7128, 15))).toBe(12320)
  })

  it('packs keys that unpack and nest', () => {
    const k = tileKey(15, 9647, 12320)
    expect([keyZ(k), keyX(k), keyY(k)]).toEqual([15, 9647, 12320])
    const p = parentKey(k)
    expect([keyZ(p), keyX(p), keyY(p)]).toEqual([14, 4823, 6160])
    expect(isDescendant(k, p)).toBe(true)
    expect(isDescendant(k, tileKey(9, 150, 192))).toBe(true)
    expect(isDescendant(k, tileKey(9, 151, 192))).toBe(false)
    expect(isDescendant(p, k)).toBe(false)
    expect(isDescendant(k, k)).toBe(false)
    expect(parentKey(tileKey(0, 0, 0))).toBe(tileKey(0, 0, 0))
    expect(new Set([tileKey(15, 0, 1), tileKey(15, 1, 0), tileKey(14, 0, 1)]).size).toBe(3)
  })

  it('covers the NYC box with a small z9 range and a wide z15 one', () => {
    expect(bboxTileRange(NYC, 9)).toEqual({ x0: 150, y0: 192, x1: 151, y1: 192 })
    const r = bboxTileRange(NYC, 15)
    expect(r.x0).toBeLessThan(9647)
    expect(r.x1).toBeGreaterThan(9647)
    expect(r.y0).toBeLessThan(12320)
    expect(r.y1).toBeGreaterThan(12320)
  })

  it('halves the tile width each zoom', () => {
    expect(tileWidthM(15) * 2).toBeCloseTo(tileWidthM(14), 6)
    expect(tileWidthM(15)).toBeGreaterThan(900)
    expect(tileWidthM(15)).toBeLessThan(940)
  })

  it('picks the zoom whose tile pixels match the screen, clamped', () => {
    expect(zoomFor(metersPerPixel(13), 15)).toBe(13)
    expect(zoomFor(metersPerPixel(13) * 1.3, 15)).toBe(13)
    expect(zoomFor(metersPerPixel(13) * 0.6, 15)).toBe(14)
    expect(zoomFor(0.01, 15)).toBe(15)
    expect(zoomFor(0.01, 14)).toBe(14)
    expect(zoomFor(1e6, 15)).toBe(MIN_Z)
  })
})
