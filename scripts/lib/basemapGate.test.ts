import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { assertGate, attributionText, gateProblems } from './basemapGate.ts'
import { parseBasemapFile } from './basemapSpec.ts'

const dir = new URL('../../data/basemap/', import.meta.url)
const { spec } = parseBasemapFile(JSON.parse(readFileSync(new URL('basemap.json', dir), 'utf8')))
/** The metadata of Protomaps build 20261121, as `pmtiles show --metadata` printed it; the terms were reviewed against it. */
const source = JSON.parse(readFileSync(new URL('source-metadata.20261121.json', dir), 'utf8')) as Record<string, unknown>

type Layer = { id: string }
const layers = (meta: Record<string, unknown>) => meta.vector_layers as Layer[]
/** What tile-join leaves: the kept layers, the attribution and description as they were, its own version and keys. */
function output(): Record<string, unknown> {
  return {
    ...source,
    version: '2',
    format: 'pbf',
    generator: 'tile-join v2.79.0',
    vector_layers: layers(source).filter((l) => spec.layers.includes(l.id)),
  }
}

describe('the source gate', () => {
  it('passes the reviewed build', () => {
    expect(gateProblems(source, spec, 'source')).toEqual([])
    expect(() => assertGate(source, spec, 'source')).not.toThrow()
  })

  it('reads the visible text of the attribution', () => {
    expect(attributionText(source.attribution as string)).toBe('© OpenStreetMap')
    expect(attributionText('<a href="x">&copy; OpenStreetMap</a>, ESA')).toBe('© OpenStreetMap, ESA')
  })

  it('rejects a credit beyond OpenStreetMap', () => {
    const meta = { ...source, attribution: `${source.attribution as string} <a href="https://esa-worldcover.org">ESA WorldCover</a>` }
    expect(gateProblems(meta, spec, 'source').join()).toMatch(/attribution is .*ESA WorldCover/)
    expect(() => assertGate(meta, spec, 'source')).toThrow(/licensing gate/)
  })

  it('rejects a changed description', () => {
    const meta = { ...source, description: 'Basemap layers derived from OpenStreetMap, Natural Earth and Tilezen' }
    expect(gateProblems(meta, spec, 'source').join()).toMatch(/description is/)
  })

  it('rejects a kept layer that is missing', () => {
    const meta = { ...source, vector_layers: layers(source).filter((l) => l.id !== 'roads') }
    expect(gateProblems(meta, spec, 'source')).toEqual(['kept layer roads is missing'])
  })

  it('rejects a layer the spec has not reviewed', () => {
    const meta = { ...source, vector_layers: [...layers(source), { id: 'transit' }] }
    expect(gateProblems(meta, spec, 'source').join()).toMatch(/layer transit is new/)
  })

  it('rejects another major version, and a version that is not x.y.z', () => {
    expect(gateProblems({ ...source, version: '5.0.0' }, spec, 'source').join()).toMatch(/version is 5.0.0/)
    expect(gateProblems({ ...source, version: '4' }, spec, 'source').join()).toMatch(/version is 4,/)
    expect(gateProblems({ ...source, version: '4.99.1' }, spec, 'source')).toEqual([])
  })

  it('rejects a metadata key it has not seen, but takes new planetiler and pgf ones', () => {
    expect(gateProblems({ ...source, credits: 'ESA' }, spec, 'source').join()).toMatch(/key credits is new/)
    expect(gateProblems({ ...source, 'planetiler:new': '1', 'pgf:x:y': '2' }, spec, 'source')).toEqual([])
  })

  it('throws, not reports, when the metadata is not the expected shape', () => {
    expect(() => gateProblems({ ...source, vector_layers: 'roads' }, spec, 'source')).toThrow(/vector_layers/)
    expect(() => gateProblems({ ...source, attribution: undefined }, spec, 'source')).toThrow(/attribution/)
    expect(() => gateProblems(null, spec, 'source')).toThrow(/metadata/)
  })
})

describe('the output gate', () => {
  it('passes what tile-join leaves, whatever version it wrote', () => {
    expect(gateProblems(output(), spec, 'output')).toEqual([])
  })

  it.each(['landcover', 'places', 'pois', 'buildings', 'boundaries'])('rejects the %s layer kept', (id) => {
    const meta = { ...output(), vector_layers: [...layers(output()), { id }] }
    expect(gateProblems(meta, spec, 'output')).toEqual([`layer ${id} should have been dropped`])
  })

  it('rejects a lost kept layer and a changed attribution', () => {
    expect(gateProblems({ ...output(), vector_layers: [{ id: 'earth' }] }, spec, 'output').join()).toMatch(/kept layer water, landuse, roads is missing/)
    expect(gateProblems({ ...output(), attribution: 'Tilezen' }, spec, 'output').join()).toMatch(/attribution/)
  })
})
