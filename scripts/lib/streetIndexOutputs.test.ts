/**
 * The committed street index (worker/data/streetIndex.json, bundled into the Worker) against the build: fresh (rebuilding from
 * the committed pin and stations.json reproduces the file byte for byte), under the raw cap, well formed, and every street filed
 * under exactly the keys of its name. Rerun `npm run data:search:streets` when it fails (after data, data:streets:fetch, a
 * change to the searchText.ts synonyms, GENERIC_TOKENS or isStreet).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../src/data/schema.ts'
import { STREET_INDEX_FORMAT, type StreetIndexFile } from '../../worker/src/streetIndexSchema.ts'
import { entryKeys } from '../../worker/src/streetKeys.ts'
import { STREET_INDEX_RAW_CAP_BYTES } from './budget.ts'
import { buildStreetIndex } from './streetIndex.ts'
import { packStreetIndex, STREET_ATTRIBUTION } from './streetIndexPack.ts'
import { toStableJson } from './stableJson.ts'
import { loadPin } from './streetsPin.ts'
import type { StreetShard, StreetsManifest } from './streetsShard.ts'

const FILE = new URL('../../worker/data/streetIndex.json', import.meta.url)
const PIN = new URL('../../data/streets/', import.meta.url)
const json = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))

const stations = (json(new URL('../../public/data/stations.json', import.meta.url)) as StationsFile).stations
const manifest = json(new URL('manifest.json', PIN)) as StreetsManifest
const text = readFileSync(FILE, 'utf8')
const index = JSON.parse(text) as StreetIndexFile

describe('committed street index', () => {
  it('is fresh: rebuilding from the pin and stations reproduces the file byte for byte', () => {
    const pin = loadPin(manifest, new Map(manifest.shards.map((s) => [s.file, json(new URL(s.file, PIN)) as StreetShard])))
    const fresh = toStableJson(packStreetIndex(buildStreetIndex(pin, stations).entries, pin.baseTimestamp), 2)
    expect(fresh === text, 'stale street index: run npm run data:search:streets').toBe(true)
  }, 60_000)

  it('stays under the raw cap (a Worker counts its script uncompressed)', () => {
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(STREET_INDEX_RAW_CAP_BYTES)
  })

  it('carries the envelope: format, ODbL, the OSM credit and the pin\'s timestamp', () => {
    expect([index.format, index.license, index.attribution, index.osmTimestamp]).toEqual([STREET_INDEX_FORMAT, 'ODbL-1.0', STREET_ATTRIBUTION, manifest.baseTimestamp])
  })

  it('files each street under exactly the keys of its name: sorted, unique, ascending indices', () => {
    const want = new Map<string, number[]>()
    index.streets.forEach(([name], i) => entryKeys([name]).forEach((k) => want.set(k, [...(want.get(k) ?? []), i])))
    expect(index.keys).toEqual([...want].sort((a, b) => (a[0] < b[0] ? -1 : 1)))
    expect(index.keys.length).toBeGreaterThan(100)
  })

  it('has unique (borough, name) streets, names that fit a "Name, Borough" label, and every site inside NYC', () => {
    const seen = new Set<string>()
    for (const [name, borough, , sites] of index.streets) {
      expect(seen.has(`${borough}\t${name}`), name).toBe(false)
      seen.add(`${borough}\t${name}`)
      expect(name.includes(', '), name).toBe(false)
      expect(sites.length, name).toBeGreaterThan(0)
      for (const [lat, lon] of sites) expect(lat > 40.45 && lat < 40.95 && lon > -74.3 && lon < -73.65, `${name} inside NYC`).toBe(true)
    }
    expect(index.streets.length).toBeGreaterThan(3000)
  })

  it('has every intersection name two different streets of one borough, with its site inside NYC', () => {
    expect(index.intersections.length).toBeGreaterThan(10_000)
    for (const [a, b, [lat, lon]] of index.intersections) {
      expect(a).not.toBe(b)
      expect(index.streets[a]?.[1]).toBe(index.streets[b]?.[1])
      expect(lat > 40.45 && lat < 40.95 && lon > -74.3 && lon < -73.65).toBe(true)
    }
  })
})
