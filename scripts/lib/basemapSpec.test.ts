import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBasemapFile, releaseAssetUrl, releaseTag } from './basemapSpec.ts'

const committed = JSON.parse(readFileSync(new URL('../../data/basemap/basemap.json', import.meta.url), 'utf8')) as unknown

const sha = 'ab12cd34'.repeat(8)
const legacy = { build: '20261121', basemapVersion: '4.15.2', release: `basemap-20261121-${sha.slice(0, 8)}`, sha256: sha, bytes: 33_000_000 }
const pin = { ...legacy, asset: 'nyc-tiles.tar.gz' as const, files: 3820, tileBytes: 44_878_229 }
const withPin = (p: unknown) => ({ spec: (committed as { spec: unknown }).spec, pin: p })

describe('the committed basemap.json', () => {
  it('parses, keeps the four layers the footer credit covers and drops the other five', () => {
    const { spec } = parseBasemapFile(committed)
    expect(spec.layers).toEqual(['earth', 'water', 'landuse', 'roads'])
    expect([...spec.dropLayers].sort()).toEqual(['boundaries', 'buildings', 'landcover', 'places', 'pois'])
    expect(spec.maxzoom).toBe(15)
  })
})

describe('parseBasemapFile', () => {
  it('accepts a null pin and a full one', () => {
    expect(parseBasemapFile(withPin(null)).pin).toBeNull()
    expect(parseBasemapFile(withPin(pin)).pin).toEqual(pin)
  })

  it('parses a pin without an asset as the legacy pmtiles pin, so main stays deployable', () => {
    expect(parseBasemapFile(withPin(legacy)).pin).toEqual({ ...legacy, legacy: true })
    expect(() => parseBasemapFile(withPin({ ...legacy, files: 3820 }))).toThrow(/unknown key/)
  })

  it('builds the release tag and the asset URL', () => {
    expect(releaseTag('20261121', sha)).toBe(pin.release)
    expect(releaseAssetUrl(pin)).toBe(`https://github.com/cazzer/underground/releases/download/${pin.release}/nyc-tiles.tar.gz`)
  })

  it.each([
    ['a release that does not match the sha', { ...pin, release: 'basemap-20261121-00000000' }, /does not match/],
    ['a bad sha', { ...pin, sha256: 'xyz' }, /sha256/],
    ['a bad build', { ...pin, build: '2026-11-21' }, /YYYYMMDD/],
    ['no bytes', { ...pin, bytes: 0 }, /bytes/],
    ['no file count', { ...pin, files: 0 }, /files/],
    ['no tile bytes', { ...pin, tileBytes: 1.5 }, /tileBytes/],
    ['a missing file count', { ...pin, files: undefined }, /files/],
    ['another asset', { ...pin, asset: 'nyc.pmtiles' }, /asset/],
    ['a null asset', { ...pin, asset: null }, /asset/],
    ['an unknown key', { ...pin, extra: 1 }, /unknown key/],
  ])('rejects %s', (_name, bad, message) => {
    expect(() => parseBasemapFile(withPin(bad))).toThrow(message)
  })

  it('rejects a spec that keeps and drops one layer, forgets one, or has a bad box', () => {
    const spec = (committed as { spec: Record<string, unknown> }).spec
    const parse = (changes: Record<string, unknown>) => () => parseBasemapFile({ spec: { ...spec, ...changes }, pin: null })
    expect(parse({ dropLayers: ['buildings', 'landcover', 'places', 'pois', 'boundaries', 'roads'] })).toThrow(/both kept and dropped/)
    expect(parse({ dropLayers: ['buildings', 'landcover', 'places', 'pois'] })).toThrow(/neither kept nor dropped/)
    expect(parse({ layers: ['earth', 'water', 'landuse', 'transit'] })).toThrow(/expected one of/)
    expect(parse({ bbox: [-73, 40, -74, 41] })).toThrow(/bbox/)
    expect(parse({ maxzoom: 16 })).toThrow(/maxzoom/)
  })
})
