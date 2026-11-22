/** Builds public/data/search/streets/<bucket>.json, the citywide street and intersection search shards, from the pinned
 *  OSM ways (data/streets/, npm run data:streets:fetch) and public/data/stations.json (each street's borough and site
 *  stations). Offline. The only IO here; the work is scripts/lib/streetIndex.ts and streetIndexShards.ts. Every shard is
 *  built and cap-checked in memory before any is written. The shards load on demand, outside the 60 KB startup budget;
 *  this prints that budget's total before and after to show it did not move. */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { StationsFile } from '../src/data/schema.ts'
import { bucketFileName, STREET_BUCKETS } from '../src/lib/searchBucket.ts'
import {
  checkFileCap,
  checkStreetIndexTotal,
  committedGzip,
  GZIP_BUDGET_BYTES,
  renderedFile,
  SEARCH_STREETS_FILE_GZIP_CAP_BYTES,
  SEARCH_STREETS_TOTAL_GZIP_CAP_BYTES,
} from './lib/budget.ts'
import { buildStreetIndex } from './lib/streetIndex.ts'
import { bucketStreetShards } from './lib/streetIndexShards.ts'
import { toStableJson } from './lib/stableJson.ts'
import { loadPin } from './lib/streetsPin.ts'
import type { StreetShard, StreetsManifest } from './lib/streetsShard.ts'

const PIN_DIR = new URL('../data/streets/', import.meta.url)
const DATA_DIR = new URL('../public/data/', import.meta.url)
const OUT_DIR = new URL('../public/data/search/streets/', import.meta.url)
const FILE_RE = /^[0-9a-f]{2}\.json$/
const TOP_FILES = 5

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`
const startupTotal = (): number => Object.values(committedGzip(DATA_DIR, new Set())).reduce((a, b) => a + b, 0)

function main(): void {
  const startupBefore = startupTotal()
  const manifest = readJson(new URL('manifest.json', PIN_DIR)) as StreetsManifest
  const shards = new Map(manifest.shards.map((s) => [s.file, readJson(new URL(s.file, PIN_DIR)) as StreetShard]))
  const pin = loadPin(manifest, shards)
  const stations = (readJson(new URL('stations.json', DATA_DIR)) as StationsFile).stations

  const { entries, stats } = buildStreetIndex(pin, stations)
  const files = bucketStreetShards(entries, pin.baseTimestamp).map((s) => renderedFile(bucketFileName(s.bucket), toStableJson(s, 2)))
  for (const f of files) {
    if (!FILE_RE.test(f.name)) throw new Error(`${f.name}: not a safe file name`)
    checkFileCap(f, SEARCH_STREETS_FILE_GZIP_CAP_BYTES)
  }
  const gzipTotal = checkStreetIndexTotal(files)
  const rawTotal = files.reduce((sum, f) => sum + f.raw, 0)

  mkdirSync(OUT_DIR, { recursive: true })
  for (const f of files) writeFileSync(new URL(f.name, OUT_DIR), f.text)
  const written = new Set(files.map((f) => f.name))
  for (const name of readdirSync(OUT_DIR)) {
    if (!name.endsWith('.json') || written.has(name)) continue
    if (!FILE_RE.test(name)) {
      console.warn(`WARNING: search/streets/${name}: not a bucket file name, left in place`)
      continue
    }
    rmSync(new URL(name, OUT_DIR))
    console.log(`search/streets/${name}: removed (no such bucket any more)`)
  }

  const startupAfter = startupTotal()
  if (startupAfter !== startupBefore) throw new Error(`startup budget total moved from ${startupBefore} B to ${startupAfter} B`)

  console.log(`search/streets: ${stats.streets} streets (${stats.sites} sites, ${stats.multiBoroughKeys} names in more than one borough), ${stats.intersections} intersections`)
  console.log(`search/streets: ${stats.borderAmbiguousVertices} street vertices near another borough's station (borough may be wrong), ${stats.displayFallbacks} names kept as OSM wrote them`)
  console.log(`search/streets: ${TOP_FILES} largest files`)
  for (const f of [...files].sort((a, b) => b.gzip - a.gzip || (a.name < b.name ? -1 : 1)).slice(0, TOP_FILES)) {
    console.log(`  search/streets/${f.name}: ${f.raw} bytes (${f.gzip} gzipped, cap ${SEARCH_STREETS_FILE_GZIP_CAP_BYTES})`)
  }
  console.log(`search/streets/: ${files.length} files of ${STREET_BUCKETS} buckets, ${rawTotal} bytes raw (${kb(rawTotal)}), ${gzipTotal} gzipped (cap ${SEARCH_STREETS_TOTAL_GZIP_CAP_BYTES})`)
  console.log(`public/data startup total gzip: ${startupBefore} B before, ${startupAfter} B after (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
