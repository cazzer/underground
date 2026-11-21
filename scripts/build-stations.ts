/** Builds public/data/stations/<id>.json from data/stations/<id>.authored.json plus the pinned
 *  data/stations/<id>.sources.json, and generated ones from the station catalog (data/stations/catalog/) with the
 *  committed public/data/shapes.json and stations.json (scripts/lib/generate.ts; a hand-authored station wins),
 *  public/data/stations/index.json (which stations have an interior), and public/data/station-depths.json (every interior's
 *  platform tracks, packed: scripts/lib/depthsPack.ts). Offline: the network is only used by fetch-station-sources.ts.
 *  The only IO here; the merge is scripts/lib/stationMerge.ts. Everything is built in memory first. */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { ShapesFile, StationsFile } from '../src/data/schema.ts'
import type { StationInterior } from '../src/data/stationSchema.ts'
import { TRACK_OFFSET_M } from '../src/lib/trackOffset.ts'
import type { AuthoredStation, StationSources } from './lib/stationInputs.ts'
import { checkBudget, checkIndexCap, committedGzip, GZIP_BUDGET_BYTES, INDEX_GZIP_CAP_BYTES, renderedFile } from './lib/budget.ts'
import { drawnLines, PACK_TOL_M, packStationDepths, renderPackedDepths } from './lib/depthsPack.ts'
import { generateStations } from './lib/generate.ts'
import { CATALOG_FILES, generatorCatalog, generatorLines } from './lib/generatorInputs.ts'
import { buildStationDepths } from './lib/stationDepths.ts'
import { buildStationIndex, INDEX_FILE, NOT_INTERIOR_FILES } from './lib/stationIndex.ts'
import { buildStationInterior } from './lib/stationMerge.ts'
import { markGenerated } from './lib/stationProvenance.ts'
import { toStableJson } from './lib/stableJson.ts'

const IN_DIR = new URL('../data/stations/', import.meta.url)
const CATALOG_DIR = new URL('../data/stations/catalog/', import.meta.url)
const OUT_DIR = new URL('../public/data/stations/', import.meta.url)
const DATA_DIR = new URL('../public/data/', import.meta.url)
const DEPTHS = 'station-depths.json'
const INDEX = INDEX_FILE
const SUFFIX = '.authored.json'

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T
}

/** One hand-authored station: its `.authored.json` merged with its pinned sources. */
function buildAuthored(id: string): StationInterior {
  const authored = readJson<AuthoredStation>(new URL(`${id}${SUFFIX}`, IN_DIR))
  if (authored.stationId !== id) throw new Error(`${id}${SUFFIX}: stationId is ${JSON.stringify(authored.stationId)}`)
  const sourcesUrl = new URL(`${id}.sources.json`, IN_DIR)
  let sources: StationSources
  try {
    sources = readJson<StationSources>(sourcesUrl)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    throw new Error(`Missing ${id}.sources.json: run npm run data:stations:fetch -- --station ${id}`)
  }
  if (sources.stationId !== id) throw new Error(`${id}.sources.json: stationId is ${JSON.stringify(sources.stationId)}`)
  return buildStationInterior(authored, sources)
}

function main(): void {
  const ids = readdirSync(IN_DIR)
    .filter((f) => f.endsWith(SUFFIX))
    .map((f) => f.slice(0, -SUFFIX.length))
    .sort()
  if (ids.length === 0) throw new Error(`No *${SUFFIX} files in ${IN_DIR.pathname}`)
  const authoredInteriors = ids.map(buildAuthored)

  // A hand-authored station always wins over a generated one.
  const catalog = generatorCatalog(Object.fromEntries(CATALOG_FILES.map((f) => [f, readJson(new URL(f, CATALOG_DIR))])) as Record<(typeof CATALOG_FILES)[number], unknown>)
  const shapesFile = readJson<ShapesFile>(new URL('shapes.json', DATA_DIR))
  const stationsFile = readJson<StationsFile>(new URL('stations.json', DATA_DIR))
  const lines = generatorLines(shapesFile, stationsFile)
  const result = generateStations(catalog, lines)
  for (const line of result.log) console.log(`generate: ${line}`)
  console.log(`generate: ${result.stations.length} stations generated, ${result.skipped.length} skipped`)
  for (const s of result.skipped) console.log(`generate: skipped ${s.stationId}: ${s.reason}`)
  const generated = result.stations
  const authoredIds = new Set(ids)
  const skipped = generated.filter((g) => authoredIds.has(g.authored.stationId)).map((g) => g.authored.stationId)
  if (skipped.length > 0) console.log(`generated stations skipped (hand-authored wins): ${skipped.join(', ')}`)
  const generatedInteriors = generated
    .filter((g) => !authoredIds.has(g.authored.stationId))
    .map((g) => markGenerated(buildStationInterior(g.authored, g.sources), g.meta))
  const interiors = [...authoredInteriors, ...generatedInteriors]

  // Every interior's depths load up front, packed against the stations and drawn lines the client builds.
  const packed = packStationDepths(buildStationDepths(interiors), stationsFile, drawnLines(shapesFile.shapes, TRACK_OFFSET_M))
  // The client never warns about these (they are packed as no track); this is where they show.
  if (packed.notRidden.length > 0) {
    console.warn(`WARNING: station-depths: no drawn line rides ${packed.notRidden.length} interior track(s); the map keeps them at street level: ${packed.notRidden.join(', ')}`)
  }
  if (packed.inexact.length > 0) {
    const list = packed.inexact.map(({ stopId, errorM }) => `${stopId} ${errorM.toFixed(1)} m`).join(', ')
    throw new Error(`station-depths: ${packed.inexact.length} track(s) pack more than ${PACK_TOL_M} m off their runs (${list}). Nothing written.`)
  }
  console.log(`station-depths: ${packed.file.station.length} stations, ${packed.split.length} track(s) packed on their own: ${packed.split.join(', ')}`)
  const depths = renderedFile(DEPTHS, renderPackedDepths(packed.file))
  // index.json is fetched right after startup (not render-blocking, no waiting for a first focus), so it
  // isn't in this budget; it has its own cap instead.
  const index = renderedFile(INDEX, toStableJson(buildStationIndex(interiors), 2))
  checkIndexCap(index)
  // The client loads station-depths.json up front, so it shares the 60 KB budget with the GTFS files (the one limit).
  const total = checkBudget([depths], committedGzip(DATA_DIR, new Set([DEPTHS])))
  const files = interiors.map((interior) => ({ id: interior.stationId, json: toStableJson(interior, 2) }))
  mkdirSync(OUT_DIR, { recursive: true })
  const generatedIds = new Set(generatedInteriors.map((i) => i.stationId))
  let generatedRaw = 0
  let generatedGzip = 0
  for (const { id, json } of files) {
    writeFileSync(new URL(`${id}.json`, OUT_DIR), json)
    const [raw, gz] = [Buffer.byteLength(json), gzipSync(json).length]
    if (!generatedIds.has(id)) console.log(`stations/${id}.json: ${raw} bytes (${gz} gzipped)`)
    generatedRaw += generatedIds.has(id) ? raw : 0
    generatedGzip += generatedIds.has(id) ? gz : 0
  }
  console.log(`stations/: ${generatedIds.size} generated interiors, ${generatedRaw} bytes (${generatedGzip} gzipped, each loads on focus)`)
  // A station that is no longer generated (or authored) loses its file, so the index and the files agree.
  const written = new Set(files.map((f) => `${f.id}.json`))
  for (const name of readdirSync(OUT_DIR)) {
    if (!name.endsWith('.json') || written.has(name) || NOT_INTERIOR_FILES.has(name)) continue
    rmSync(new URL(name, OUT_DIR))
    console.log(`stations/${name}: removed (no interior any more)`)
  }
  writeFileSync(new URL(INDEX, OUT_DIR), index.text)
  console.log(`stations/${INDEX}: ${index.raw} bytes (${index.gzip} gzipped, cap ${INDEX_GZIP_CAP_BYTES})`)
  writeFileSync(new URL(DEPTHS, DATA_DIR), depths.text)
  console.log(`${DEPTHS}: ${depths.raw} bytes (${depths.gzip} gzipped)`)
  console.log(`public/data total gzip: ${total} B (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
