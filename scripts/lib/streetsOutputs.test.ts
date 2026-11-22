/**
 * The committed street files (public/data/streets/) against the build: one per station, each under the per-file
 * cap, every index valid, closed ways closed exactly as the pin has them, and fresh (rebuilding from the committed pin,
 * stations and catalog entrances reproduces every file byte for byte). Rerun `npm run data:streets` when it fails.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { deltaDecode } from '../../src/data/codec.ts'
import type { StationsFile } from '../../src/data/schema.ts'
import type { StationStreets } from '../../src/data/streetSchema.ts'
import { isClosedRing } from '../../src/lib/streetClass.ts'
import { STREETS_FILE_GZIP_CAP_BYTES, STREETS_TOTAL_GZIP_CAP_BYTES } from './budget.ts'
import { complexLeadIds } from './stationComplexes.ts'
import { toStableJson } from './stableJson.ts'
import { buildAllStreets, WALK_RADIUS_M } from './streetsBuild.ts'
import { EDGE_MARGIN_M, entrancesByStation, parseComplexOf, parseEntranceRows } from './streetsEntrances.ts'
import { loadPin } from './streetsPin.ts'
import type { StreetShard, StreetsManifest } from './streetsShard.ts'

const OUT = new URL('../../public/data/streets/', import.meta.url)
const PIN = new URL('../../data/streets/', import.meta.url)
const json = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))

const stationsFile = json(new URL('../../public/data/stations.json', import.meta.url)) as StationsFile
const stations = stationsFile.stations
const leads = complexLeadIds(stationsFile.complexes, stations)
const manifest = json(new URL('manifest.json', PIN)) as StreetsManifest
const pin = loadPin(manifest, new Map(manifest.shards.map((s) => [s.file, json(new URL(s.file, PIN)) as StreetShard])))
const entranceRows = entrancesByStation(
  parseEntranceRows(json(new URL('../../data/stations/catalog/entrances.json', import.meta.url))),
  parseComplexOf(json(new URL('../../data/stations/catalog/stations.json', import.meta.url))),
)
const names = readdirSync(OUT).filter((f) => f.endsWith('.json')).sort()
const fresh = buildAllStreets(stations, pin, entranceRows, leads)
const pinClosed = new Map(pin.ways.map((w) => [w.way.id, isClosedRing(w.way.nodes)]))

describe('committed street files', () => {
  it('are one per station, and no others', () => {
    expect(names).toEqual(stations.map((s) => `${s.id}.json`).sort())
  })

  it('are fresh: rebuilding from the pin, stations and entrances reproduces every file byte for byte', () => {
    expect(fresh.map((r) => r.file.stationId)).toEqual(stations.map((s) => s.id))
    const stale: string[] = []
    for (const { file } of fresh) {
      if (toStableJson(file, 2) !== readFileSync(new URL(`${file.stationId}.json`, OUT), 'utf8')) stale.push(file.stationId)
    }
    expect(stale, 'stale street files: run npm run data:streets').toEqual([])
  }, 60_000)

  it('stay under the per-file and total gzip caps', () => {
    let total = 0
    for (const name of names) {
      const gzip = gzipSync(readFileSync(new URL(name, OUT)), { level: 9 }).length
      expect(gzip, name).toBeLessThanOrEqual(STREETS_FILE_GZIP_CAP_BYTES)
      total += gzip
    }
    expect(total).toBeLessThanOrEqual(STREETS_TOTAL_GZIP_CAP_BYTES)
  })

  it('have valid indexes, ascending ids, closed rings as the pin has them, sorted ways and entrances', () => {
    for (const name of names) {
      const file = json(new URL(name, OUT)) as StationStreets
      expect(file.x.length, name).toBe(file.nodeId.length)
      expect(file.z.length, name).toBe(file.nodeId.length)
      expect(file.format).toBe(1)
      const ids = deltaDecode(file.nodeId)
      expect(ids.every((id, i) => Number.isSafeInteger(id) && (i === 0 || id > ids[i - 1]!)), `${name} node ids strictly ascending`).toBe(true)
      expect([file.radiusM, file.walkRadiusM], name).toEqual([manifest.radiusM, WALK_RADIUS_M])
      expect(file.osmTimestamp).toBe(manifest.baseTimestamp)
      expect(file.attribution[0]).toBe('© OpenStreetMap contributors')
      expect(file.attribution.length === 3, name).toBe(file.entrances.length > 0)
      expect(file.ways.map((w) => w.id), name).toEqual(file.ways.map((w) => w.id).sort((a, b) => a - b))
      const ways = new Set<number>()
      for (const w of file.ways) {
        ways.add(w.id)
        expect(w.nodes.length, `${name} way ${w.id}`).toBeGreaterThanOrEqual(2)
        for (const n of w.nodes) expect(Number.isInteger(n) && n >= 0 && n < file.nodeId.length, `${name} way ${w.id} node ${n}`).toBe(true)
        expect(isClosedRing(w.nodes), `${name} way ${w.id}`).toBe(pinClosed.get(w.id))
      }
      file.entrances.forEach((e, i) => {
        if (e.wayId !== null) expect(ways.has(e.wayId), `${name} entrance ${i} wayId`).toBe(true)
        if (e.crossWayId !== null) expect(ways.has(e.crossWayId), `${name} entrance ${i} crossWayId`).toBe(true)
        const prev = file.entrances[i - 1]
        if (prev !== undefined) expect(prev.x < e.x || (prev.x === e.x && prev.z <= e.z), `${name} entrance order`).toBe(true)
      })
    }
  })

  it("give every member of Union Sq (L03, R20 and 635) the complex's 12 entrances", () => {
    const count = (id: string): number => (json(new URL(`${id}.json`, OUT)) as StationStreets).entrances.length
    expect([count('L03'), count('R20'), count('635')]).toEqual([12, 12, 12])
  })

  it("hold no entrance shared from another member of the complex that is beyond 260 m, or an elevator outside a lead's file", () => {
    for (const name of names) {
      const file = json(new URL(name, OUT)) as StationStreets
      for (const e of file.entrances) {
        if (e.stopIds.includes(file.stationId)) continue
        if (!leads.has(file.stationId)) expect(e.type, `${name} shared entrance at (${e.x}, ${e.z}) dm`).not.toBe('Elevator')
        expect(Math.hypot(e.x, e.z) / 10, `${name} ${e.type} at (${e.x}, ${e.z}) dm`).toBeLessThanOrEqual(file.radiusM - EDGE_MARGIN_M)
      }
    }
  })

  it("give a complex's lead the elevators of its other members, once each (Times Sq 725 has 902's)", () => {
    const times = json(new URL('725.json', OUT)) as StationStreets
    expect(times.entrances.filter((e) => e.type === 'Elevator' && e.stopIds.includes('902')).length).toBe(1)
    for (const lead of leads) {
      const file = json(new URL(`${lead}.json`, OUT)) as StationStreets
      const lifts = file.entrances.filter((e) => e.type === 'Elevator')
      for (const [i, a] of lifts.entries()) {
        for (const b of lifts.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z), `${lead} lifts at (${a.x}, ${a.z}) dm`).toBeGreaterThan(15)
      }
    }
  })

  it('give Bedford Av (L08) its Bedford Av and North 7th Street corner', () => {
    const l08 = json(new URL('L08.json', OUT)) as StationStreets
    expect(l08.entrances.some((e) => [e.street, e.cross].includes('Bedford Avenue') && [e.street, e.cross].includes('North 7th Street'))).toBe(true)
  })
})
