/** Builds public/data/walk/<stationId>.json for every station in public/data/stations.json from the pinned OSM ways
 *  (data/streets/, npm run data:streets:fetch): the walkable graph within 300 m. Offline. The only IO here; the work is
 *  scripts/lib/walkGraph.ts. Every file is built and cap-checked in memory before any is written, and files of stations
 *  that are gone are removed. Walk files load on demand, outside the 60 KB startup budget; this prints that budget's
 *  total before and after to show it did not move. */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { StationsFile } from '../src/data/schema.ts'
import { checkFileCap, checkWalkTotal, committedGzip, GZIP_BUDGET_BYTES, renderedFile, WALK_FILE_GZIP_CAP_BYTES, WALK_TOTAL_GZIP_CAP_BYTES } from './lib/budget.ts'
import { toStableJson } from './lib/stableJson.ts'
import { loadPin } from './lib/streetsPin.ts'
import type { StreetShard, StreetsManifest } from './lib/streetsShard.ts'
import { buildAllWalks, largestComponentShare, WALK_GRAPH_RADIUS_M } from './lib/walkGraph.ts'

const PIN_DIR = new URL('../data/streets/', import.meta.url)
const DATA_DIR = new URL('../public/data/', import.meta.url)
const OUT_DIR = new URL('../public/data/walk/', import.meta.url)
const FILE_RE = /^[A-Za-z0-9]+\.json$/
const TOP_FILES = 5
const LOW_CONNECTIVITY = 0.9

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`
const startupTotal = (): number => Object.values(committedGzip(DATA_DIR, new Set())).reduce((a, b) => a + b, 0)

function main(): void {
  const startupBefore = startupTotal()
  const manifest = readJson(new URL('manifest.json', PIN_DIR)) as StreetsManifest
  if (manifest.walk !== true) throw new Error('data/streets/manifest.json has no walking ways (walk is not true); refetch with npm run data:streets:fetch')
  if (manifest.radiusM < WALK_GRAPH_RADIUS_M) throw new Error(`data/streets/manifest.json radiusM is ${manifest.radiusM}, the walk build needs ${WALK_GRAPH_RADIUS_M}`)
  const shards = new Map(manifest.shards.map((s) => [s.file, readJson(new URL(s.file, PIN_DIR)) as StreetShard]))
  const pin = loadPin(manifest, shards)
  const stations = (readJson(new URL('stations.json', DATA_DIR)) as StationsFile).stations

  // A station added since the pin was fetched still gets a file (from whatever ways of the pin lie near it); say so.
  const pinned = new Set(manifest.stationIds)
  for (const s of stations) {
    if (!pinned.has(s.id)) console.warn(`WARNING: ${s.id} is not in the street pin (rerun npm run data:streets:fetch); its walk file may be partial or empty`)
  }
  const results = buildAllWalks(stations, pin)
  const files = results.map((r) => renderedFile(`${r.file.stationId}.json`, toStableJson(r.file, 2)))
  for (const f of files) {
    if (!FILE_RE.test(f.name)) throw new Error(`${f.name}: not a safe file name`)
    checkFileCap(f, WALK_FILE_GZIP_CAP_BYTES)
  }
  const gzipTotal = checkWalkTotal(files)
  const rawTotal = files.reduce((sum, f) => sum + f.raw, 0)

  mkdirSync(OUT_DIR, { recursive: true })
  for (const f of files) writeFileSync(new URL(f.name, OUT_DIR), f.text)
  const written = new Set(files.map((f) => f.name))
  for (const name of readdirSync(OUT_DIR)) {
    if (!name.endsWith('.json') || written.has(name)) continue
    if (!FILE_RE.test(name)) {
      console.warn(`WARNING: walk/${name}: not a station file name, left in place`)
      continue
    }
    rmSync(new URL(name, OUT_DIR))
    console.log(`walk/${name}: removed (no such station any more)`)
  }

  const startupAfter = startupTotal()
  if (startupAfter !== startupBefore) throw new Error(`startup budget total moved from ${startupBefore} B to ${startupAfter} B`)

  for (const [i, r] of results.entries()) {
    if (r.file.edgeNodes.length === 0) console.log(`WARNING: no walkable ways within ${WALK_GRAPH_RADIUS_M} m, wrote an empty walk file: ${stations[i]!.id} ${stations[i]!.name}`)
  }
  console.log(`walk: ${results.reduce((sum, r) => sum + r.excluded, 0)} way/station pairs within ${WALK_GRAPH_RADIUS_M} m excluded for foot/access tags`)
  console.log(`walk: ${TOP_FILES} largest files`)
  for (const f of [...files].sort((a, b) => b.gzip - a.gzip || (a.name < b.name ? -1 : 1)).slice(0, TOP_FILES)) {
    console.log(`  walk/${f.name}: ${f.raw} bytes (${f.gzip} gzipped, cap ${WALK_FILE_GZIP_CAP_BYTES})`)
  }
  const low = results
    .map((r, i) => ({ station: stations[i]!, ...largestComponentShare(r.file) }))
    .filter((c) => c.share < LOW_CONNECTIVITY)
    .sort((a, b) => a.share - b.share || (a.station.id < b.station.id ? -1 : 1))
  console.log(`walk: ${low.length} stations where the largest connected piece holds under ${LOW_CONNECTIVITY * 100}% of the walkable length`)
  for (const c of low) console.log(`  ${c.station.id} ${c.station.name}: ${(c.share * 100).toFixed(0)}% in the largest of ${c.components} pieces`)
  console.log(`walk/: ${files.length} files, ${rawTotal} bytes raw (${kb(rawTotal)}), ${gzipTotal} gzipped (cap ${WALK_TOTAL_GZIP_CAP_BYTES}); radius ${WALK_GRAPH_RADIUS_M} m`)
  console.log(`public/data startup total gzip: ${startupBefore} B before, ${startupAfter} B after (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
