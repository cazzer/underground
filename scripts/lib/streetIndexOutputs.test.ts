/**
 * The committed street search shards (public/data/search/streets/) against the build: exactly the 64 bucket files, each
 * under the per-file cap, every entry in the buckets of its keys and nowhere else, and fresh (rebuilding from the
 * committed pin and stations.json reproduces every file byte for byte). Rerun `npm run data:search:streets` when it fails
 * (after data, data:streets:fetch, a change to the searchText.ts synonyms, GENERIC_TOKENS or isStreet).
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { StationsFile } from '../../src/data/schema.ts'
import type { IntersectionEntry, StreetEntry, StreetSearchShard } from '../../src/data/searchSchema.ts'
import { toGround } from '../../src/lib/projection.ts'
import { bucketFileName, bucketOf, entryBucketKeys, queryBucketKey, STREET_BUCKETS } from '../../src/lib/searchBucket.ts'
import { SEARCH_STREETS_FILE_GZIP_CAP_BYTES, SEARCH_STREETS_TOTAL_GZIP_CAP_BYTES } from './budget.ts'
import { buildStreetIndex } from './streetIndex.ts'
import { bucketStreetShards } from './streetIndexShards.ts'
import { toStableJson } from './stableJson.ts'
import { loadPin } from './streetsPin.ts'
import type { StreetShard, StreetsManifest } from './streetsShard.ts'

const OUT = new URL('../../public/data/search/streets/', import.meta.url)
const PIN = new URL('../../data/streets/', import.meta.url)
const json = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))

const stations = (json(new URL('../../public/data/stations.json', import.meta.url)) as StationsFile).stations
const manifest = json(new URL('manifest.json', PIN)) as StreetsManifest
const names = readdirSync(OUT).filter((f) => f.endsWith('.json')).sort()
const expected = Array.from({ length: STREET_BUCKETS }, (_, b) => bucketFileName(b))
const shardOf = (bucket: number): StreetSearchShard => json(new URL(bucketFileName(bucket), OUT)) as StreetSearchShard

/** What the client does: the entries of the query's one shard that carry its key. */
function lookup(query: string): StreetSearchShard['entries'] {
  const key = queryBucketKey(query)!
  return shardOf(bucketOf(key, STREET_BUCKETS)).entries.filter((e) => entryBucketKeys(e.kind === 'street' ? [e.name] : e.names).includes(key))
}

describe('committed street search shards', () => {
  it('are exactly the 64 bucket files', () => {
    expect(names).toEqual(expected)
  })

  it('are fresh: rebuilding from the pin and stations reproduces every file byte for byte', () => {
    const pin = loadPin(manifest, new Map(manifest.shards.map((s) => [s.file, json(new URL(s.file, PIN)) as StreetShard])))
    const fresh = bucketStreetShards(buildStreetIndex(pin, stations).entries, pin.baseTimestamp)
    const stale: string[] = []
    for (const shard of fresh) {
      const name = bucketFileName(shard.bucket)
      if (toStableJson(shard, 2) !== readFileSync(new URL(name, OUT), 'utf8')) stale.push(name)
    }
    expect(stale, 'stale street search shards: run npm run data:search:streets').toEqual([])
  }, 60_000)

  it('stay under the per-file and total gzip caps', () => {
    let total = 0
    for (const name of names) {
      const gzip = gzipSync(readFileSync(new URL(name, OUT)), { level: 9 }).length
      expect(gzip, name).toBeLessThanOrEqual(SEARCH_STREETS_FILE_GZIP_CAP_BYTES)
      total += gzip
    }
    expect(total).toBeLessThanOrEqual(SEARCH_STREETS_TOTAL_GZIP_CAP_BYTES)
  }, 60_000)

  it('carry the envelope and file every entry in exactly the buckets of its keys', () => {
    const filed = new Map<string, number[]>()
    const wanted = new Map<string, number[]>()
    for (const name of names) {
      const shard = json(new URL(name, OUT)) as StreetSearchShard
      expect([shard.format, shard.family, shard.buckets, shard.license]).toEqual([1, 'streets', STREET_BUCKETS, 'ODbL-1.0'])
      expect(bucketFileName(shard.bucket), name).toBe(name)
      expect(shard.attribution).toEqual(['© OpenStreetMap contributors'])
      expect(shard.osmTimestamp).toBe(manifest.baseTimestamp)
      for (const e of shard.entries) {
        const id = JSON.stringify(e)
        filed.set(id, [...(filed.get(id) ?? []), shard.bucket])
        wanted.set(id, [...new Set(entryBucketKeys(e.kind === 'street' ? [e.name] : e.names).map((k) => bucketOf(k, STREET_BUCKETS)))].sort((a, b) => a - b))
      }
    }
    expect(filed.size).toBeGreaterThan(10_000)
    const wrong = [...filed].filter(([id, buckets]) => JSON.stringify(buckets) !== JSON.stringify(wanted.get(id)))
    expect(wrong.slice(0, 3)).toEqual([])
  }, 60_000)

  it('name every intersection street as a street of the same borough, and put every site on a known station inside the city', () => {
    const ids = new Set(stations.map((s) => s.id))
    const seen = new Set<string>()
    for (const name of names) {
      for (const e of (json(new URL(name, OUT)) as StreetSearchShard).entries) {
        const id = JSON.stringify(e)
        if (seen.has(id)) continue
        seen.add(id)
        if (e.kind === 'street') {
          expect(e.sites.length, e.name).toBeGreaterThan(0)
          expect(e.sites.map((s) => s[2]), e.name).toEqual([...e.sites.map((s) => s[2])].sort())
        }
        for (const [lat, lon, station] of e.kind === 'street' ? e.sites : [e.site]) {
          expect(ids.has(station), `${JSON.stringify(e)} station`).toBe(true)
          expect(lat > 40.45 && lat < 40.95 && lon > -74.3 && lon < -73.65, `${JSON.stringify(e)} inside NYC`).toBe(true)
        }
      }
    }
    const streetIds = new Set<string>()
    for (const id of seen) {
      const e = JSON.parse(id) as StreetEntry | IntersectionEntry
      if (e.kind === 'street') streetIds.add(`${e.borough}\t${e.name}`)
    }
    for (const id of seen) {
      const e = JSON.parse(id) as StreetEntry | IntersectionEntry
      if (e.kind === 'intersection') for (const n of e.names) expect(streetIds.has(`${e.borough}\t${n}`), `${id}: ${n}`).toBe(true)
    }
  }, 60_000)

  it('finds Bedford Av and N 7 St by their query bucket', () => {
    const hit = lookup('bedford av & n 7 st').find((e): e is IntersectionEntry => e.kind === 'intersection' && e.borough === 'Bk' && e.names[0] === 'Bedford Av' && e.names[1] === 'N 7 St')
    expect(hit).toBeDefined()
    const a = toGround({ lat: hit!.site[0], lon: hit!.site[1] })
    const b = toGround({ lat: 40.71784, lon: -73.95773 })
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(30)
  })

  it('finds W 40 St in Manhattan, Broadway in four boroughs and W 4 St in two', () => {
    const w40 = lookup('w 40 st').find((e): e is StreetEntry => e.kind === 'street' && e.borough === 'M' && e.name === 'W 40 St')
    expect(w40?.sites.length).toBeGreaterThanOrEqual(1)
    const broadway = lookup('broadway').filter((e): e is StreetEntry => e.kind === 'street' && e.name === 'Broadway')
    expect(broadway.map((e) => e.borough).sort()).toEqual(['Bk', 'Bx', 'M', 'Q'])
    const w4 = lookup('w 4 st').filter((e): e is StreetEntry => e.kind === 'street' && e.name === 'W 4 St')
    expect(w4.map((e) => e.borough).sort()).toEqual(expect.arrayContaining(['Bk', 'M']))
  })
})
