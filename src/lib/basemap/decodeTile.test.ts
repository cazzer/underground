import { describe, expect, it } from 'vitest'
import { groundX, groundZ } from '../projection'
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
    const out = decodeTile(bytes, Z, X, Y, LAYERS)
    expectSegments(out.major, [[...at(0, 1000), ...at(1000, 1000)], [...at(1000, 1000), ...at(1000, 3000)]])
    expect(Object.keys(out)).toEqual(['major'])
  })

  it('draws a polygon outline without the tiler cut along the tile edge', () => {
    // A park running off the west edge: its ring follows x = 0 there.
    const ring: [number, number][] = [[0, 100], [500, 100], [500, 600], [0, 600]]
    const bytes = writeMvt([{ name: 'landuse', features: [{ type: 3, props: { kind: 'park' }, parts: [ring] }] }])
    const out = decodeTile(bytes, Z, X, Y, LAYERS)
    expectSegments(out.park, [
      [...at(0, 100), ...at(500, 100)],
      [...at(500, 100), ...at(500, 600)],
      [...at(500, 600), ...at(0, 600)],
    ])
  })

  it('drops earth, points, tunnels and layers outside the spec', () => {
    const bytes = writeMvt([
      { name: 'earth', features: [{ type: 3, props: { kind: 'earth' }, parts: [[[0, 0], [10, 0], [10, 10]]] }] },
      { name: 'roads', features: [{ type: 2, props: { kind: 'highway', is_tunnel: true }, parts: [[[0, 0], [10, 10]]] }] },
      { name: 'water', features: [{ type: 1, props: { kind: 'water' }, parts: [[[5, 5]]] }] },
      { name: 'landuse', features: [{ type: 3, props: { kind: 'park' }, parts: [[[0, 0], [10, 0], [10, 10]]] }] },
    ])
    expect(decodeTile(bytes, Z, X, Y, ['earth', 'roads', 'water'])).toEqual({})
  })

  it('decodes an empty tile to nothing', () => {
    expect(decodeTile(new Uint8Array(), Z, X, Y, LAYERS)).toEqual({})
  })
})
