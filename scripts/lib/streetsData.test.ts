/** Reads the committed data/streets/ pin: the manifest, the shards and public/data/stations.json must agree.
 *  It does not compare feedVersion: stations.json refreshes daily and a new station may need a fetch. */
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ROAD_CLASSES, STREET_TAGS, UNCOVERED_STATIONS, WALK_CLASSES, stationsWithoutNamedWay } from './streetsOsm.ts'
import type { PinNode, StreetStation } from './streetsOsm.ts'
import { shardCell, shardFileName } from './streetsShard.ts'
import type { StreetsManifest, StreetShard } from './streetsShard.ts'

const dir = new URL('../../data/streets/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8')) as StreetsManifest
const shards = new Map(manifest.shards.map((s) => [s.file, JSON.parse(readFileSync(new URL(s.file, dir), 'utf8')) as StreetShard]))
const stations = (JSON.parse(readFileSync(new URL('../../public/data/stations.json', import.meta.url), 'utf8')) as { stations: StreetStation[] }).stations

describe('the street pin manifest', () => {
  it('records its provenance and query', () => {
    expect(manifest.license).toBe('ODbL-1.0')
    expect(manifest.attribution).toBe('© OpenStreetMap contributors')
    expect(Date.parse(manifest.fetchedAt)).not.toBeNaN()
    expect(Date.parse(manifest.baseTimestamp)).not.toBeNaN()
    expect(manifest.overpassUrl).toBe('https://overpass-api.de/api/interpreter')
    expect(manifest.radiusM).toBe(300)
    expect(manifest.walk).toBe(true)
    expect(manifest.roadClasses).toEqual(ROAD_CLASSES)
    expect(manifest.walkClasses).toEqual(WALK_CLASSES)
    expect(manifest.query.perStation).toContain('around:300,LAT,LON')
    expect(manifest.query.head).toContain('[out:json]')
    expect(manifest.query.tail).toContain('out geom;')
    expect(manifest.stationsFeedVersion).not.toBe('')
    expect(manifest.stations).toBeGreaterThan(400)
  })
  it('lists exactly the shard files on disk, sorted, with their counts', () => {
    const onDisk = readdirSync(dir).filter((f) => f !== 'manifest.json').sort()
    expect(manifest.shards.map((s) => s.file)).toEqual(onDisk)
    for (const s of manifest.shards) {
      const shard = shards.get(s.file)!
      expect(s.ways, s.file).toBe(shard.ways.length)
      expect(s.nodes, s.file).toBe(shard.nodes.length)
      expect(s.file).toBe(shardFileName(shard.cell, manifest.cellDeg))
    }
  })
})

describe('the street pin shards', () => {
  it('sort ways and nodes by id, with each way id in one shard only', () => {
    const wayIds = new Set<number>()
    for (const [file, shard] of shards) {
      const ids = shard.ways.map((w) => w.id)
      expect(ids, file).toEqual([...ids].sort((a, b) => a - b))
      const nodeIds = shard.nodes.map((n) => n[0])
      expect(nodeIds, file).toEqual([...nodeIds].sort((a, b) => a - b))
      expect(new Set(nodeIds).size, file).toBe(nodeIds.length)
      for (const id of ids) {
        expect(wayIds.has(id), `way ${id} in ${file} and another shard`).toBe(false)
        wayIds.add(id)
      }
    }
  })
  it('hold only STREET_TAGS, every way node in the node table, and the first vertex in the shard cell', () => {
    for (const [file, shard] of shards) {
      const coords = new Map<number, PinNode>(shard.nodes.map((n) => [n[0], [n[1], n[2]]]))
      for (const w of shard.ways) {
        expect(w.nodes.length, `${file} way ${w.id}`).toBeGreaterThanOrEqual(2)
        for (const k of Object.keys(w.tags)) expect(STREET_TAGS, `${file} way ${w.id} tag ${k}`).toContain(k)
        for (const n of w.nodes) expect(coords.has(n), `${file} way ${w.id} node ${n}`).toBe(true)
        const first = coords.get(w.nodes[0]!)!
        expect(shardCell({ lat: first[0], lon: first[1] }, manifest.cellDeg), `${file} way ${w.id}`).toEqual(shard.cell)
      }
    }
  })
  it('give a node the same coordinates in every shard', () => {
    const seen = new Map<number, PinNode>()
    for (const [file, shard] of shards) {
      for (const [id, lat, lon] of shard.nodes) {
        const prev = seen.get(id)
        if (prev !== undefined) expect([lat, lon], `${file} node ${id}`).toEqual([...prev])
        seen.set(id, [lat, lon])
      }
    }
  })
  it('reach every station with a named way, or list it in UNCOVERED_STATIONS', () => {
    const nodes = new Map<number, PinNode>()
    for (const shard of shards.values()) for (const [id, lat, lon] of shard.nodes) nodes.set(id, [lat, lon])
    const ways = [...shards.values()].flatMap((s) => s.ways)
    const bare = stationsWithoutNamedWay(stations, ways, nodes, manifest.radiusM).filter((s) => !UNCOVERED_STATIONS.includes(s.id))
    // A station added since the pin was fetched fails here: rerun `npm run data:streets:fetch` and review the diff.
    expect(bare.map((s) => `${s.id} ${s.name}`)).toEqual([])
  })
})
