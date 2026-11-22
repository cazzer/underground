/** Reads the committed data/streets/ pin: the manifest and the shards must agree, and every station the manifest lists
 *  (`stationIds`) that is still in public/data/stations.json must have a named way near it (a station dropped from
 *  the feed is skipped; build-streets.ts removes its file). It does not compare feedVersion:
 *  stations.json refreshes daily, and a station added since is only warned about by build-streets.ts. */
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
    expect(manifest.stationIds).toHaveLength(manifest.stations)
    expect(manifest.stationIds).toEqual([...manifest.stationIds].sort())
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
    const bad: string[] = []
    const wayIds = new Set<number>()
    for (const [file, shard] of shards) {
      const ids = shard.ways.map((w) => w.id)
      if (ids.some((id, i) => i > 0 && id <= ids[i - 1]!)) bad.push(`${file}: way ids not strictly ascending`)
      const nodeIds = shard.nodes.map((n) => n[0])
      if (nodeIds.some((id, i) => i > 0 && id <= nodeIds[i - 1]!)) bad.push(`${file}: node ids not strictly ascending`)
      for (const id of ids) {
        if (wayIds.has(id)) bad.push(`way ${id} in ${file} and another shard`)
        wayIds.add(id)
      }
    }
    expect(bad).toEqual([])
  })
  it('hold only STREET_TAGS, allowed classes, names on every road, and at least 2 nodes per way', () => {
    const bad: string[] = []
    const allowed = new Set([...ROAD_CLASSES, ...(manifest.walk ? WALK_CLASSES : [])])
    for (const [file, shard] of shards) {
      for (const w of shard.ways) {
        const at = `${file} way ${w.id}`
        if (w.nodes.length < 2) bad.push(`${at}: ${w.nodes.length} nodes`)
        for (const k of Object.keys(w.tags)) if (!STREET_TAGS.includes(k)) bad.push(`${at}: tag ${k}`)
        const highway = w.tags.highway
        if (highway === undefined || !allowed.has(highway)) bad.push(`${at}: highway=${String(highway)}`)
        else if (w.tags.name === undefined && !(manifest.walk && WALK_CLASSES.includes(highway))) bad.push(`${at}: unnamed highway=${highway}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('have every way node in the shard node table and the first vertex in the shard cell', () => {
    const bad: string[] = []
    for (const [file, shard] of shards) {
      const coords = new Map<number, PinNode>(shard.nodes.map((n) => [n[0], [n[1], n[2]]]))
      for (const w of shard.ways) {
        for (const n of w.nodes) if (!coords.has(n)) bad.push(`${file} way ${w.id}: node ${n} missing from the table`)
        const first = coords.get(w.nodes[0]!)
        if (first === undefined) continue
        const cell = shardCell({ lat: first[0], lon: first[1] }, manifest.cellDeg)
        if (cell.i !== shard.cell.i || cell.j !== shard.cell.j) bad.push(`${file} way ${w.id}: first vertex is in cell ${cell.i},${cell.j}`)
      }
    }
    expect(bad).toEqual([])
  })
  it('give a node the same coordinates in every shard', () => {
    const bad: string[] = []
    const seen = new Map<number, PinNode>()
    for (const [file, shard] of shards) {
      for (const [id, lat, lon] of shard.nodes) {
        const prev = seen.get(id)
        if (prev !== undefined && (prev[0] !== lat || prev[1] !== lon)) bad.push(`${file} node ${id}`)
        seen.set(id, [lat, lon])
      }
    }
    expect(bad).toEqual([])
  })
  it('reach every station with a named way, or list it in UNCOVERED_STATIONS', () => {
    const nodes = new Map<number, PinNode>()
    for (const shard of shards.values()) for (const [id, lat, lon] of shard.nodes) nodes.set(id, [lat, lon])
    const ways = [...shards.values()].flatMap((s) => s.ways)
    const bare = stationsWithoutNamedWay(stations.filter((s) => manifest.stationIds.includes(s.id)), ways, nodes, manifest.radiusM).filter((s) => !UNCOVERED_STATIONS.includes(s.id))
    // Only the stations the pin was fetched for: a station added since is warned about by `npm run data:streets`, and
    // is covered by the next `npm run data:streets:fetch`.
    expect(bare.map((s) => `${s.id} ${s.name}`)).toEqual([])
  })
})
