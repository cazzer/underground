import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseBasemapFile, releaseAssetUrl, releaseTag } from './basemapSpec.ts'

const committed = JSON.parse(readFileSync(new URL('../../data/basemap/basemap.json', import.meta.url), 'utf8')) as unknown

const sha = 'ab12cd34'.repeat(8)
const pin = { build: '20261121', basemapVersion: '4.15.2', release: `basemap-20261121-${sha.slice(0, 8)}`, sha256: sha, bytes: 33_000_000 }
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

  it('builds the release tag and the asset URL', () => {
    expect(releaseTag('20261121', sha)).toBe(pin.release)
    expect(releaseAssetUrl(pin)).toBe(`https://github.com/cazzer/underground/releases/download/${pin.release}/nyc.pmtiles`)
  })

  it.each([
    ['a release that does not match the sha', { ...pin, release: 'basemap-20261121-00000000' }, /does not match/],
    ['a bad sha', { ...pin, sha256: 'xyz' }, /sha256/],
    ['a bad build', { ...pin, build: '2026-11-21' }, /YYYYMMDD/],
    ['no bytes', { ...pin, bytes: 0 }, /bytes/],
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
