/** Pins the OSM streets and walking ways near every station into data/streets/ (a manifest and sharded cell-*.json).
 *
 *  npm run data:streets:fetch -- [--no-walk] [--batches N] [--overpass <url>]
 *
 *  Uses the network (the Overpass API, public and read-only; the requests carry only the public station points
 *  of public/data/stations.json), so it only runs by hand; CI and every other `npm run data*` stay offline.
 *  The response is untrusted: scripts/lib/streetsOsm.ts validates and trims it, and nothing is written unless
 *  every request succeeds, every station has a named way nearby and the sizes are within budget.
 *
 *  One request for the whole city, tried once; if Overpass is overloaded (504, timeout, a dropped connection or a
 *  runtime-error remark) the stations are split into sequential batches, each with the usual retries (also
 *  `--batches N` to start there), and the answers merged by way id. Any other failure, a 400 for one, stops. The default
 *  server is the one the catalog fetch uses; `--overpass` is for a person to point elsewhere. */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { finite, list, record, text } from './lib/check.ts'
import { getJson, isRetryable, sleep } from './lib/fetchJson.ts'
import { toStableJson } from './lib/stableJson.ts'
import { RADIUS_M, ROAD_CLASSES, UNCOVERED_STATIONS, WALK_CLASSES, mergeOverpass, streetsQuery, streetsQueryParts, trimOverpassStreets } from './lib/streetsOsm.ts'
import type { StreetStation } from './lib/streetsOsm.ts'
import { CELL_DEG, shardFileName, shardStreets } from './lib/streetsShard.ts'
import type { StreetsManifest } from './lib/streetsShard.ts'

const DIR = new URL('../data/streets/', import.meta.url)
const STATIONS = new URL('../public/data/stations.json', import.meta.url)
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const OVERPASS_TIMEOUT_MS = 660_000
const FALLBACK_BATCHES = 8
const BATCH_PAUSE_S = 15
const MAX_FILE_BYTES = 2_000_000
const MAX_TOTAL_BYTES = 30_000_000
const MAX_TOTAL_BYTES_NO_WALK = 8_000_000

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

function readStations(): { feedVersion: string; stations: StreetStation[] } {
  const root = record(JSON.parse(readFileSync(STATIONS, 'utf8')), 'stations.json')
  const stations = list(root.stations, 'stations.json.stations').map((raw, i): StreetStation => {
    const s = record(raw, `stations.json.stations[${i}]`)
    return { id: text(s.id, `stations[${i}].id`), name: text(s.name, `stations[${i}].name`), lat: finite(s.lat, `stations[${i}].lat`), lon: finite(s.lon, `stations[${i}].lon`) }
  })
  return { feedVersion: text(root.feedVersion, 'stations.json.feedVersion'), stations }
}

/** Overpass answers HTTP 200 with a `remark` (and partial elements) when a query hits its time or memory limit. */
class RemarkError extends Error {
  override name = 'RemarkError'
}

async function post(url: string, query: string, retries?: number): Promise<unknown> {
  const body = new URLSearchParams({ data: query })
  const json = await getJson(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, OVERPASS_TIMEOUT_MS, retries)
  const remark = record(json, 'overpass').remark
  if (typeof remark === 'string') throw new RemarkError(`overpass remark (the answer may be partial): ${remark}`)
  return json
}

/** Stations in `n` contiguous latitude bands, so each request covers a compact share of the city. */
function batchesOf(stations: readonly StreetStation[], n: number): StreetStation[][] {
  const sorted = [...stations].sort((a, b) => a.lat - b.lat)
  const size = Math.ceil(sorted.length / n)
  return Array.from({ length: n }, (_, i) => sorted.slice(i * size, (i + 1) * size)).filter((b) => b.length > 0)
}

async function fetchBatches(url: string, stations: readonly StreetStation[], walk: boolean, n: number): Promise<{ response: unknown; requests: number }> {
  const batches = batchesOf(stations, n)
  const answers: unknown[] = []
  for (const [i, batch] of batches.entries()) {
    if (i > 0) await sleep(BATCH_PAUSE_S)
    console.log(`batch ${i + 1} of ${batches.length}: ${batch.length} stations`)
    answers.push(await post(url, streetsQuery(batch, RADIUS_M, walk)))
  }
  return { response: mergeOverpass(answers), requests: batches.length }
}

async function fetchStreets(url: string, stations: readonly StreetStation[], walk: boolean, batches: number): Promise<{ response: unknown; requests: number }> {
  if (batches > 1) return fetchBatches(url, stations, walk, batches)
  try {
    return { response: await post(url, streetsQuery(stations, RADIUS_M, walk), 0), requests: 1 }
  } catch (err) {
    if (!(err instanceof RemarkError) && !isRetryable(err)) throw err
    console.log(`the single request failed (${err instanceof Error ? err.message : String(err)}); falling back to ${FALLBACK_BATCHES} batches`)
    await sleep(BATCH_PAUSE_S)
    return fetchBatches(url, stations, walk, FALLBACK_BATCHES)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const walk = !args.includes('--no-walk')
  const url = option(args, '--overpass') ?? OVERPASS_URL
  const batches = Number(option(args, '--batches') ?? 1)
  if (!Number.isInteger(batches) || batches < 1) throw new Error('--batches needs a whole number of 1 or more')
  const { feedVersion, stations } = readStations()

  const { response, requests } = await fetchStreets(url, stations, walk, batches)
  const trimmed = trimOverpassStreets(response, stations, { radiusM: RADIUS_M, walk, exceptions: UNCOVERED_STATIONS })
  const shards = shardStreets(trimmed)

  const manifest: StreetsManifest = {
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    fetchedAt: new Date().toISOString(),
    baseTimestamp: trimmed.baseTimestamp,
    overpassUrl: url,
    requests,
    radiusM: RADIUS_M,
    walk,
    cellDeg: CELL_DEG,
    roadClasses: ROAD_CLASSES,
    walkClasses: walk ? WALK_CLASSES : [],
    query: streetsQueryParts(RADIUS_M, walk),
    stations: stations.length,
    stationsFeedVersion: feedVersion,
    shards: shards.map((s) => ({ file: shardFileName(s.cell), ways: s.ways.length, nodes: s.nodes.length })),
  }
  const files = [
    ...shards.map((s) => ({ name: shardFileName(s.cell), text: toStableJson(s, 2) })),
    { name: 'manifest.json', text: toStableJson(manifest, 2) },
  ]
  let total = 0
  let gzipped = 0
  let largest = { name: '', bytes: 0 }
  const cap = walk ? MAX_TOTAL_BYTES : MAX_TOTAL_BYTES_NO_WALK
  for (const { name, text: body } of files) {
    const bytes = Buffer.byteLength(body)
    total += bytes
    gzipped += gzipSync(body).length
    if (bytes > largest.bytes) largest = { name, bytes }
    if (bytes > MAX_FILE_BYTES) throw new Error(`${name} is ${bytes} bytes, over the ${MAX_FILE_BYTES} byte budget; halve CELL_DEG in scripts/lib/streetsShard.ts (and give the shard names more decimals); nothing written`)
  }
  console.log(`${shards.length} shards, ${trimmed.ways.length} ways, ${trimmed.nodes.size} nodes (shards repeat border nodes)`)
  console.log(`total ${(total / 1000).toFixed(0)} KB raw, ${(gzipped / 1000).toFixed(0)} KB gzip; largest ${largest.name} ${(largest.bytes / 1000).toFixed(0)} KB`)
  if (total > cap) throw new Error(`the pin is ${total} bytes, over the ${cap} byte budget${walk ? '; rerun with --no-walk to keep the named roads only' : ''}; nothing written`)

  mkdirSync(DIR, { recursive: true })
  const names = new Set(files.map((f) => f.name))
  // Everything new is written and renamed first; only then is anything old deleted, so an interrupt never leaves a pin with files missing (the data test rejects a half-renamed one).
  const stale = readdirSync(DIR).filter((f) => (/^cell-.*\.json$/.test(f) && !names.has(f)) || (f.endsWith('.tmp') && !names.has(f.slice(0, -4))))
  for (const { name, text: body } of files) writeFileSync(new URL(`${name}.tmp`, DIR), body)
  for (const { name } of files) renameSync(new URL(`${name}.tmp`, DIR), new URL(name, DIR))
  for (const f of stale) rmSync(new URL(f, DIR))
  console.log('Review the diff of data/streets/')
}

await main()
