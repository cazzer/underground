import { describe, expect, it } from 'vitest'
import { groundX, groundZ } from '../projection'
import { buildRouteClip } from '../routeClip'
import { decodeTile, isMvtBytes } from './decodeTile'
import { writeMvt } from './mvtFixture'
import { tileXToLon, tileYToLat } from './tileMath'

const [Z, X, Y] = [15, 9647, 12320]
const E = 4096
/** Scene meters of a tile-local point in the test tile. */
const at = (u: number, v: number) => [groundX(tileXToLon(X + u / E, Z)), 0, groundZ(tileYToLat(Y + v / E, Z))]
const LAYERS = ['earth', 'water', 'landuse', 'roads']

const expectSegments = (buf: Float32Array | undefined, segments: number[][]) => {
  expect(buf).toBeDefined()
  const got = [...buf!]
  const want = segments.flat()
  expect(got.length).toBe(want.length)
  // Float32 at about 1 km from the origin: well inside a centimeter.
  got.forEach((v, i) => expect(Math.abs(v - want[i]!)).toBeLessThan(0.01))
}

describe('isMvtBytes', () => {
  it('accepts an empty tile and a Tile message', () => {
    expect(isMvtBytes(new Uint8Array())).toBe(true)
    expect(isMvtBytes(writeMvt([{ name: 'roads', features: [] }]))).toBe(true)
  })

  it('rejects an HTML page and a gzipped tile', () => {
    expect(isMvtBytes(new TextEncoder().encode('<!doctype html>'))).toBe(false)
    expect(isMvtBytes(new Uint8Array([0x1f, 0x8b, 8, 0]))).toBe(false)
  })
})

describe('decodeTile', () => {
  it('projects a road to scene meters and clips it at the tile edge', () => {
    const bytes = writeMvt([
      { name: 'roads', features: [{ type: 2, props: { kind: 'major_road' }, parts: [[[-200, 1000], [1000, 1000], [1000, 3000]]] }] },
    ])
    const out = decodeTile(bytes, Z, X, Y, LAYERS, null)
    expectSegments(out.major, [[...at(0, 1000), ...at(1000, 1000)], [...at(1000, 1000), ...at(1000, 3000)]])
    expect(Object.keys(out)).toEqual(['major'])
  })

  it('draws a polygon outline without the tiler cut along the tile edge', () => {
    // A park running off the west edge: its ring follows x = 0 there.
    const ring: [number, number][] = [[0, 100], [500, 100], [500, 600], [0, 600]]
    const bytes = writeMvt([{ name: 'landuse', features: [{ type: 3, props: { kind: 'park' }, parts: [ring] }] }])
    const out = decodeTile(bytes, Z, X, Y, LAYERS, null)
    expectSegments(out.park, [
      [...at(0, 100), ...at(500, 100)],
      [...at(500, 100), ...at(500, 600)],
      [...at(500, 600), ...at(0, 600)],
    ])
  })

  it('drops a ring under 1 ha before z14, unless it reaches the tile edge', () => {
    // At z12 a tile is about 7.4 km across, so 4096 units are about 1.8 m each: a 40-unit square is about 0.5 ha.
    const [z, x, y] = [12, X >> 3, Y >> 3]
    const small: [number, number][] = [[100, 100], [140, 100], [140, 140], [100, 140], [100, 100]]
    const atEdge: [number, number][] = [[0, 100], [40, 100], [40, 140], [0, 140]]
    const big: [number, number][] = [[1000, 1000], [1300, 1000], [1300, 1300], [1000, 1300], [1000, 1000]]
    const tile = (parts: [number, number][][]) => writeMvt([{ name: 'landuse', features: [{ type: 3, props: { kind: 'park' }, parts }] }])
    expect(decodeTile(tile([small]), z, x, y, LAYERS, null).park).toBeUndefined()
    expect(decodeTile(tile([atEdge]), z, x, y, LAYERS, null).park).toBeDefined()
    expect(decodeTile(tile([big]), z, x, y, LAYERS, null).park!.length).toBe(4 * 6)
    // The same small square at z15 (about 0.22 m a unit, so far under 1 ha) is drawn.
    expect(decodeTile(tile([small]), Z, X, Y, LAYERS, null).park!.length).toBe(4 * 6)
  })

  it('drops earth, points, tunnels and layers outside the spec', () => {
    const bytes = writeMvt([
      { name: 'earth', features: [{ type: 3, props: { kind: 'earth' }, parts: [[[0, 0], [10, 0], [10, 10]]] }] },
      { name: 'roads', features: [{ type: 2, props: { kind: 'highway', is_tunnel: true }, parts: [[[0, 0], [10, 10]]] }] },
      { name: 'water', features: [{ type: 1, props: { kind: 'water' }, parts: [[[5, 5]]] }] },
      { name: 'landuse', features: [{ type: 3, props: { kind: 'park' }, parts: [[[0, 0], [10, 0], [10, 10]]] }] },
    ])
    expect(decodeTile(bytes, Z, X, Y, ['earth', 'roads', 'water'], null)).toEqual({})
  })

  it('cuts roads running along a track, and keeps crossings and water along it', () => {
    // A track along tile row v = 1000 from u = 100 to 3000; at z15 a unit is about 0.22 m.
    const track = [at(100, 1000), at(3000, 1000)].map(([x, , z]) => ({ x: x!, z: z! }))
    const along: [number, number][] = [[100, 1010], [3000, 1010]]
    const crossing: [number, number][] = [[1500, 200], [1500, 2000]]
    const pond: [number, number][] = [[100, 1000], [3000, 1000], [3000, 1500], [100, 1500], [100, 1000]]
    const bytes = writeMvt([
      { name: 'roads', features: [{ type: 2, props: { kind: 'minor_road' }, parts: [along, crossing] }] },
      { name: 'water', features: [{ type: 3, props: { kind: 'water' }, parts: [pond] }] },
    ])
    const clipped = decodeTile(bytes, Z, X, Y, LAYERS, buildRouteClip([track]))
    expectSegments(clipped.minor, [[...at(1500, 200), ...at(1500, 2000)]])
    const whole = decodeTile(bytes, Z, X, Y, LAYERS, null)
    expectSegments(whole.minor, [[...at(...along[0]!), ...at(...along[1]!)], [...at(...crossing[0]!), ...at(...crossing[1]!)]])
    expect(clipped.water).toEqual(whole.water)
    expect(whole.water).toHaveLength(4 * 6)
  })

  it('decodes an empty tile to nothing', () => {
    expect(decodeTile(new Uint8Array(), Z, X, Y, LAYERS, null)).toEqual({})
  })
})
