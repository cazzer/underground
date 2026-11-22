import { describe, expect, it } from 'vitest'
import { groundX, groundZ } from '../projection'
import { groundFootprint, MAX_REACH, MAX_TILES, selectTiles, type FrustumRays } from './footprint'
import { keyZ, latToTileY, lonToTileX, MIN_Z, tileKey } from './tileMath'

const NYC: [number, number, number, number] = [-74.2591, 40.4774, -73.7004, 40.9176]
const HALF_FOV = (17.5 * Math.PI) / 180

/** Corner rays of a camera `distance` from (tx, tz), tipped `polar` from straight down and turned `azimuth`. */
function rays(tx: number, tz: number, distance: number, polar: number, azimuth = 0, aspect = 1.5): FrustumRays {
  const p = [tx + distance * Math.sin(polar) * Math.sin(azimuth), distance * Math.cos(polar), tz + distance * Math.sin(polar) * Math.cos(azimuth)]
  // Camera basis: forward to the target, right, up (screen up).
  const f = [tx - p[0]!, -p[1]!, tz - p[2]!].map((v) => v / distance) as [number, number, number]
  const right = [Math.cos(azimuth), 0, -Math.sin(azimuth)]
  const up = [right[1]! * f[2] - right[2]! * f[1], right[2]! * f[0] - right[0]! * f[2], right[0]! * f[1] - right[1]! * f[0]]
  const t = Math.tan(HALF_FOV)
  const dirs: number[] = []
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    for (let k = 0; k < 3; k++) dirs.push(f[k]! + sx * t * aspect * right[k]! + sy * t * up[k]!)
  }
  return { p, dirs, distance }
}

const foot = (r: FrustumRays) => {
  const out = new Float64Array(8)
  groundFootprint(r, out)
  return out
}

const CITY_HALL = { x: groundX(-74.006), z: groundZ(40.7128) }

describe('groundFootprint', () => {
  it('is a rectangle around the target top-down', () => {
    const f = foot(rays(100, 200, 1000, 0))
    const halfH = 1000 * Math.tan(HALF_FOV)
    expect(f[0]).toBeCloseTo(100 - halfH * 1.5, 6)
    expect(f[1]).toBeCloseTo(200 + halfH, 6)
    expect(f[4]).toBeCloseTo(100 + halfH * 1.5, 6)
    expect(f[5]).toBeCloseTo(200 - halfH, 6)
  })

  it('reaches farther at the top of the screen when tilted', () => {
    const f = foot(rays(0, 0, 400, Math.atan(Math.SQRT2)))
    const near = Math.abs(f[1]!)
    const far = Math.abs(f[5]!)
    expect(far).toBeGreaterThan(near * 2)
    expect(f[5]).toBeLessThan(0)
  })

  it('stops a ray above the horizon at MAX_REACH camera distances', () => {
    const f = foot(rays(0, 0, 400, (80 * Math.PI) / 180))
    for (let i = 0; i < 4; i++) {
      const d = Math.hypot(f[i * 2]!, f[i * 2 + 1]! - 400 * Math.sin((80 * Math.PI) / 180))
      expect(d).toBeLessThanOrEqual(MAX_REACH * 400 + 1e-6)
    }
  })

  it('turns with the azimuth', () => {
    const f = foot(rays(0, 0, 400, Math.atan(Math.SQRT2), Math.PI / 2))
    // Turned a quarter, the camera sits east of the target and the screen's top reaches west.
    expect(f[4]).toBeLessThan(-300)
    expect(f[5]).toBeLessThan(f[3]!)
  })
})

describe('selectTiles', () => {
  it('picks the City Hall tile first, top-down at z15', () => {
    const { z, tiles } = selectTiles(foot(rays(CITY_HALL.x, CITY_HALL.z, 2000, 0)), CITY_HALL, 2000, 15, NYC)
    expect(z).toBe(15)
    expect(tiles[0]!.key).toBe(tileKey(15, 9647, 12320))
    expect(tiles.length).toBeGreaterThan(1)
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES)
    const d = tiles.map((t) => (t.x + 0.5 - lonToTileX(-74.006, 15)) ** 2 + (t.y + 0.5 - latToTileY(40.7128, 15)) ** 2)
    expect([...d].sort((a, b) => a - b)).toEqual(d)
  })

  it('leaves out tiles outside the bbox', () => {
    const bbox: [number, number, number, number] = [-74.01, 40.70, -74.0, 40.72]
    const { tiles } = selectTiles(foot(rays(CITY_HALL.x, CITY_HALL.z, 5000, 0)), CITY_HALL, 5000, 15, bbox)
    for (const t of tiles) {
      expect(t.x).toBeGreaterThanOrEqual(Math.floor(lonToTileX(-74.01, 15)))
      expect(t.x).toBeLessThanOrEqual(Math.floor(lonToTileX(-74.0, 15)))
    }
    const far = { x: groundX(-80), z: groundZ(35) }
    expect(selectTiles(foot(rays(far.x, far.z, 2000, 0)), far, 2000, 15, NYC).tiles).toEqual([])
  })

  it('steps the zoom down past MAX_TILES', () => {
    const { z, tiles } = selectTiles(foot(rays(CITY_HALL.x, CITY_HALL.z, 10_000, 0)), CITY_HALL, 10_000, 15, NYC)
    expect(z).toBeLessThan(15)
    expect(tiles.length).toBeLessThanOrEqual(MAX_TILES)
    expect(tiles.every((t) => keyZ(t.key) === z)).toBe(true)
  })

  it('takes the nearest MAX_TILES at MIN_Z', () => {
    const { z, tiles } = selectTiles(foot(rays(CITY_HALL.x, CITY_HALL.z, 3e6, 0)), CITY_HALL, 3e6, MIN_Z, [-80, 35, -68, 45])
    expect(z).toBe(MIN_Z)
    expect(tiles.length).toBe(MAX_TILES)
  })

  it('wants only tiles near a tilted view, more of them far up the screen', () => {
    const r = rays(CITY_HALL.x, CITY_HALL.z, 400, Math.atan(Math.SQRT2))
    const { z, tiles } = selectTiles(foot(r), CITY_HALL, 400, 15, NYC)
    expect(z).toBe(15)
    const ys = tiles.map((t) => t.y)
    // North (smaller y) is up the screen at azimuth 0: the footprint reaches further north than south.
    expect(12320 - Math.min(...ys)).toBeGreaterThanOrEqual(Math.max(...ys) - 12320)
  })
})
