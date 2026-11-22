/**
 * The committed walk files (public/data/walk/) against the build: one per station, each under the per-file cap, every
 * index valid, and fresh (rebuilding from the committed pin and stations reproduces every file byte for byte).
 * Rerun `npm run data:walk` when it fails.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { deltaDecode } from '../../src/data/codec.ts'
import type { StationsFile } from '../../src/data/schema.ts'
import { WALK_KINDS, type StationWalk } from '../../src/data/walkSchema.ts'
import { WALK_FILE_GZIP_CAP_BYTES, WALK_TOTAL_GZIP_CAP_BYTES } from './budget.ts'
import { toStableJson } from './stableJson.ts'
import { loadPin } from './streetsPin.ts'
import type { StreetShard, StreetsManifest } from './streetsShard.ts'
import { buildAllWalks, edgeLengthDm, largestComponentShare, WALK_GRAPH_RADIUS_M } from './walkGraph.ts'

const OUT = new URL('../../public/data/walk/', import.meta.url)
const PIN = new URL('../../data/streets/', import.meta.url)
const json = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))

const stations = (json(new URL('../../public/data/stations.json', import.meta.url)) as StationsFile).stations
const manifest = json(new URL('manifest.json', PIN)) as StreetsManifest
const names = readdirSync(OUT).filter((f) => f.endsWith('.json')).sort()

describe('committed walk files', () => {
  it('are one per station, and no others', () => {
    expect(names).toEqual(stations.map((s) => `${s.id}.json`).sort())
  })

  it('are fresh: rebuilding from the pin and stations reproduces every file byte for byte', () => {
    const pin = loadPin(manifest, new Map(manifest.shards.map((s) => [s.file, json(new URL(s.file, PIN)) as StreetShard])))
    const fresh = buildAllWalks(stations, pin)
    expect(fresh.map((r) => r.file.stationId)).toEqual(stations.map((s) => s.id))
    const stale: string[] = []
    for (const { file } of fresh) {
      if (toStableJson(file, 2) !== readFileSync(new URL(`${file.stationId}.json`, OUT), 'utf8')) stale.push(file.stationId)
    }
    expect(stale, 'stale walk files: run npm run data:walk').toEqual([])
  }, 60_000)

  it('stay under the per-file and total gzip caps', () => {
    let total = 0
    for (const name of names) {
      const gzip = gzipSync(readFileSync(new URL(name, OUT)), { level: 9 }).length
      expect(gzip, name).toBeLessThanOrEqual(WALK_FILE_GZIP_CAP_BYTES)
      total += gzip
    }
    expect(total).toBeLessThanOrEqual(WALK_TOTAL_GZIP_CAP_BYTES)
  })

  it('have valid indexes, ascending node ids, sorted edges, true lengths and one-use interiors', () => {
    for (const name of names) {
      const file = json(new URL(name, OUT)) as StationWalk
      const n = file.nodeId.length
      expect([file.x.length, file.z.length], name).toEqual([n, n])
      const edges = file.edgeNodes.length
      expect([file.edgeWay.length, file.edgeKind.length, file.edgeLength.length], name).toEqual([edges, edges, edges])
      expect(file.format).toBe(1)
      expect(file.license).toBe('ODbL-1.0')
      expect(file.attribution).toEqual(['© OpenStreetMap contributors'])
      expect([file.osmTimestamp, file.radiusM], name).toEqual([manifest.baseTimestamp, WALK_GRAPH_RADIUS_M])
      const ids = deltaDecode(file.nodeId)
      expect(ids.every((id, i) => Number.isSafeInteger(id) && (i === 0 || id > ids[i - 1]!)), `${name} node ids strictly ascending`).toBe(true)
      expect(file.x.concat(file.z).every(Number.isInteger), `${name} integer dm`).toBe(true)
      const ways = deltaDecode(file.edgeWay)
      expect(ways.every((w, i) => w > 0 && (i === 0 || w >= ways[i - 1]!)), `${name} edgeWay non-decreasing`).toBe(true)
      const uses = new Map<number, number>()
      for (const ns of file.edgeNodes) for (const i of ns) uses.set(i, (uses.get(i) ?? 0) + 1)
      file.edgeNodes.forEach((ns, e) => {
        expect(ns.length, `${name} edge ${e}`).toBeGreaterThanOrEqual(2)
        for (const i of ns) expect(Number.isInteger(i) && i >= 0 && i < n, `${name} edge ${e} node ${i}`).toBe(true)
        expect(Number.isInteger(file.edgeKind[e]) && file.edgeKind[e]! >= 0 && file.edgeKind[e]! < WALK_KINDS.length, `${name} edge ${e} kind`).toBe(true)
        expect(file.edgeLength[e], `${name} edge ${e} length`).toBe(edgeLengthDm(ns.map((i) => [file.x[i]!, file.z[i]!] as const)))
        for (const i of ns.slice(1, -1)) expect(uses.get(i), `${name} edge ${e} interior node ${i}`).toBe(1)
      })
      expect([...uses.keys()].length, `${name}: every listed node is used`).toBe(n)
    }
  })

  it('give Bedford Av (L08) sidewalks, crossings and roads in one mostly connected graph', () => {
    const l08 = json(new URL('L08.json', OUT)) as StationWalk
    const kinds = new Set(l08.edgeKind.map((k) => WALK_KINDS[k]))
    for (const kind of ['sidewalk', 'crossing', 'road']) expect(kinds.has(kind as (typeof WALK_KINDS)[number]), kind).toBe(true)
    expect(largestComponentShare(l08).share).toBeGreaterThanOrEqual(0.9)
  })
})
