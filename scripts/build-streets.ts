/** Builds public/data/streets/<stationId>.json for every station in public/data/stations.json from the pinned OSM
 *  ways (data/streets/, npm run data:streets:fetch) and the catalog entrances (data/stations/catalog/entrances.json).
 *  Offline. The only IO here; the work is scripts/lib/streetsBuild.ts. Every file is built and cap-checked in
 *  memory before any is written, and files of stations that are gone are removed.
 *  Street files load on focus, outside the 60 KB startup budget; this prints that budget's total before and after
 *  to show it did not move. */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { StationsFile } from '../src/data/schema.ts'
import { checkFileCap, checkStreetsTotal, committedGzip, GZIP_BUDGET_BYTES, renderedFile, STREETS_FILE_GZIP_CAP_BYTES, STREETS_TOTAL_GZIP_CAP_BYTES } from './lib/budget.ts'
import { toStableJson } from './lib/stableJson.ts'
import { buildAllStreets, WALK_RADIUS_M } from './lib/streetsBuild.ts'
import { entrancesByStation, median, parseEntranceRows, type BuildLog, type LogKind } from './lib/streetsEntrances.ts'
import { RADIUS_M } from './lib/streetsOsm.ts'
import { loadPin } from './lib/streetsPin.ts'
import type { StreetShard, StreetsManifest } from './lib/streetsShard.ts'

const PIN_DIR = new URL('../data/streets/', import.meta.url)
const DATA_DIR = new URL('../public/data/', import.meta.url)
const OUT_DIR = new URL('../public/data/streets/', import.meta.url)
const ENTRANCES = new URL('../data/stations/catalog/entrances.json', import.meta.url)
const FILE_RE = /^[A-Za-z0-9]+\.json$/
const TOP_FILES = 5

const readJson = (url: URL): unknown => JSON.parse(readFileSync(url, 'utf8'))
const kb = (n: number): string => `${(n / 1024).toFixed(1)} KB`

function main(): void {
  const startupBefore = Object.values(committedGzip(DATA_DIR, new Set())).reduce((a, b) => a + b, 0)
  const manifest = readJson(new URL('manifest.json', PIN_DIR)) as StreetsManifest
  if (manifest.radiusM !== RADIUS_M) throw new Error(`data/streets/manifest.json radiusM is ${manifest.radiusM}, the build clips at ${RADIUS_M}`)
  const shards = new Map(manifest.shards.map((s) => [s.file, readJson(new URL(s.file, PIN_DIR)) as StreetShard]))
  const pin = loadPin(manifest, shards)
  const stationsFile = readJson(new URL('stations.json', DATA_DIR)) as StationsFile
  const rowsOf = entrancesByStation(parseEntranceRows(readJson(ENTRANCES)))
  const unknown = [...rowsOf.keys()].filter((id) => !stationsFile.stations.some((s) => s.id === id))
  if (unknown.length > 0) console.log(`entrances: rows list ${unknown.length} stop id(s) that are not stations (ignored): ${unknown.join(', ')}`)

  // A station added since the pin was fetched still gets a file (from whatever ways of the pin lie near it); say so.
  const pinned = new Set(manifest.stationIds)
  for (const s of stationsFile.stations) {
    if (!pinned.has(s.id)) console.warn(`WARNING: ${s.id} is not in the street pin (rerun npm run data:streets:fetch); its streets file may be partial or empty`)
  }
  const results = buildAllStreets(stationsFile.stations, pin, rowsOf)
  const files = results.map((r) => renderedFile(`${r.file.stationId}.json`, toStableJson(r.file, 2)))
  for (const f of files) {
    if (!FILE_RE.test(f.name)) throw new Error(`${f.name}: not a safe file name`)
    checkFileCap(f, STREETS_FILE_GZIP_CAP_BYTES)
  }
  const gzipTotal = checkStreetsTotal(files)
  const rawTotal = files.reduce((sum, f) => sum + f.raw, 0)

  mkdirSync(OUT_DIR, { recursive: true })
  for (const f of files) writeFileSync(new URL(f.name, OUT_DIR), f.text)
  const written = new Set(files.map((f) => f.name))
  for (const name of readdirSync(OUT_DIR)) {
    if (!name.endsWith('.json') || written.has(name)) continue
    rmSync(new URL(name, OUT_DIR))
    console.log(`streets/${name}: removed (no such station any more)`)
  }

  const startupAfter = Object.values(committedGzip(DATA_DIR, new Set())).reduce((a, b) => a + b, 0)
  if (startupAfter !== startupBefore) throw new Error(`startup budget total moved from ${startupBefore} B to ${startupAfter} B`)

  const log: BuildLog[] = results.flatMap((r) => r.log)
  const byKind = (kind: LogKind): BuildLog[] => log.filter((l) => l.kind === kind)
  for (const l of log) console.log(`${l.kind === 'no-ways' ? '' : 'streets: '}${l.line}`)
  const gaps = byKind('near-miss').map((l) => l.gapM!)
  console.log('streets: log counts')
  for (const kind of ['no-street', 'near-miss', 'bridge-tunnel', 'far-entrance', 'no-entrances', 'no-ways', 'whole-way', 'oneway'] as const) {
    const extra = kind === 'near-miss' && gaps.length > 0 ? ` (median gap ${median(gaps).toFixed(1)} m)` : ''
    console.log(`  ${kind}: ${byKind(kind).length}${extra}`)
  }
  console.log(`streets: ${TOP_FILES} largest files`)
  for (const f of [...files].sort((a, b) => b.gzip - a.gzip || (a.name < b.name ? -1 : 1)).slice(0, TOP_FILES)) {
    console.log(`  streets/${f.name}: ${f.raw} bytes (${f.gzip} gzipped, cap ${STREETS_FILE_GZIP_CAP_BYTES})`)
  }
  console.log(`streets/: ${files.length} files, ${rawTotal} bytes raw (${kb(rawTotal)}), ${gzipTotal} gzipped (cap ${STREETS_TOTAL_GZIP_CAP_BYTES}); radius ${RADIUS_M} m, walking ways ${WALK_RADIUS_M} m`)
  console.log(`public/data startup total gzip: ${startupBefore} B before, ${startupAfter} B after (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
