/** Builds worker/data/streetIndex.json, the street and intersection index the Worker's /geocode searches, from the pinned
 *  OSM ways (data/streets/, npm run data:streets:fetch) and public/data/stations.json (each street's borough and site
 *  stations). Offline. The only IO here; the work is scripts/lib/streetIndex.ts and streetIndexPack.ts. The file is
 *  built and cap-checked in memory before it is written. It ships inside the Worker bundle (never to the client), so it is
 *  outside the 60 KB startup budget and has its own raw cap. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { StationsFile } from '../src/data/schema.ts'
import { checkStreetIndexCap, renderedFile, STREET_INDEX_RAW_CAP_BYTES } from './lib/budget.ts'
import { buildStreetIndex } from './lib/streetIndex.ts'
import { packStreetIndex } from './lib/streetIndexPack.ts'
import { toStableJson } from './lib/stableJson.ts'
import { loadPin } from './lib/streetsPin.ts'
import type { StreetShard, StreetsManifest } from './lib/streetsShard.ts'

const PIN_DIR = new URL('../data/streets/', import.meta.url)
const DATA_DIR = new URL('../public/data/', import.meta.url)
const OUT_DIR = new URL('../worker/data/', import.meta.url)

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`

function main(): void {
  const manifest = readJson(new URL('manifest.json', PIN_DIR)) as StreetsManifest
  const shards = new Map(manifest.shards.map((s) => [s.file, readJson(new URL(s.file, PIN_DIR)) as StreetShard]))
  const pin = loadPin(manifest, shards)
  const stations = (readJson(new URL('stations.json', DATA_DIR)) as StationsFile).stations

  const { entries, stats } = buildStreetIndex(pin, stations)
  const index = packStreetIndex(entries, pin.baseTimestamp)
  const file = renderedFile('streetIndex.json', toStableJson(index, 2))
  checkStreetIndexCap(file)
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(new URL(file.name, OUT_DIR), file.text)

  console.log(`streetIndex: ${stats.streets} streets (${stats.sites} sites, ${stats.multiBoroughKeys} names in more than one borough), ${stats.intersections} intersections, ${index.keys.length} keys`)
  console.log(`streetIndex: ${stats.borderAmbiguousVertices} street vertices near another borough's station (borough may be wrong), ${stats.displayFallbacks} names kept as OSM wrote them`)
  console.log(`worker/data/streetIndex.json: ${file.raw} bytes raw (${kb(file.raw)}, cap ${STREET_INDEX_RAW_CAP_BYTES}), ${file.gzip} gzipped`)
}

main()
