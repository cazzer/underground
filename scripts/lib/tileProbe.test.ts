import { describe, expect, it } from 'vitest'
import { MISSING_TILE, PROBE_TILES, lonLatToTile, mvtProblems, tilePath, tileProblems } from './tileProbe.ts'

/** A layer message: tag 0x1a, a one-byte length, then `n` filler bytes. */
const layer = (n: number) => [0x1a, n, ...new Array<number>(n).fill(0x0a)]
const tile = (...sizes: number[]) => Uint8Array.from(sizes.flatMap(layer))

describe('lonLatToTile', () => {
  it('matches the slippy map tiles of known points', () => {
    expect(lonLatToTile(0, 0, 0)).toEqual({ z: 0, x: 0, y: 0 })
    expect(lonLatToTile(-73.9855, 40.758, 15)).toEqual({ z: 15, x: 9649, y: 12314 })
    expect(lonLatToTile(-180, 85, 3)).toEqual({ z: 3, x: 0, y: 0 })
    expect(lonLatToTile(179.999, -85, 3)).toEqual({ z: 3, x: 7, y: 7 })
  })

  it('probes the world tile and two z15 tiles, none the absent one', () => {
    expect(PROBE_TILES.map((t) => t.z)).toEqual([0, 15, 15])
    expect(PROBE_TILES.map(tilePath)).not.toContain(tilePath(MISSING_TILE))
    expect(new Set(PROBE_TILES.map(tilePath)).size).toBe(3)
  })
})

describe('mvtProblems', () => {
  it('accepts layers that run exactly to the end, with a one- and a two-byte length', () => {
    expect(mvtProblems(tile(3, 100))).toEqual([])
    expect(mvtProblems(Uint8Array.from([0x1a, 0x80, 0x01, ...new Array<number>(128).fill(0)]))).toEqual([])
  })

  it('rejects an empty body, gzip, trailing bytes, a short layer and a field that is not a layer', () => {
    expect(mvtProblems(new Uint8Array())).toEqual(['empty body'])
    expect(mvtProblems(Uint8Array.from([0x1f, 0x8b, 0x08, 0x00]))[0]).toMatch(/not a layer tag/)
    expect(mvtProblems(Uint8Array.from([...tile(4), 0x00]))[0]).toMatch(/not a layer tag/)
    expect(mvtProblems(Uint8Array.from([0x1a, 0x09, 0x0a]))[0]).toMatch(/end at byte 11/)
    expect(mvtProblems(Uint8Array.from([0x1a]))[0]).toMatch(/bad layer length/)
  })
})

describe('tileProblems', () => {
  const body = tile(5, 7)
  const ok = { status: 200, headers: { 'content-type': 'application/octet-stream' }, body }

  it('accepts the identity answer and a gzip-offered one that decodes to the same bytes', () => {
    expect(tileProblems({ size: body.length, encoding: 'identity' }, ok)).toEqual([])
    const encoded = { ...ok, headers: { 'content-encoding': 'gzip' }, body: Uint8Array.from(body) }
    expect(tileProblems({ size: body.length, encoding: 'any', reference: body }, encoded)).toEqual([])
  })

  it('names a content-encoding on an identity request, a wrong status, size and decoded body', () => {
    expect(tileProblems({ size: body.length, encoding: 'identity' }, { ...ok, headers: { 'content-encoding': 'gzip' } })).toEqual(['content-encoding gzip on an identity request'])
    expect(tileProblems({ size: body.length, encoding: 'any' }, { ...ok, status: 404 })).toEqual(['status 404, not 200'])
    expect(tileProblems({ size: body.length + 1, encoding: 'any' }, ok)).toEqual([`body is ${body.length} bytes, the file is ${body.length + 1}`])
    expect(tileProblems({ size: body.length, encoding: 'any', reference: tile(7, 5) }, ok)).toEqual(['the decoded body differs from the identity body'])
    expect(tileProblems({ size: 4, encoding: 'any' }, { status: 200, headers: {}, body: Uint8Array.from([0x1f, 0x8b, 0x08, 0x00]) })).toEqual([expect.stringMatching(/not a layer tag/)])
  })
})
