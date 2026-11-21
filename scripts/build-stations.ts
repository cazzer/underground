/** Builds public/data/stations/<id>.json from data/stations/<id>.authored.json plus the pinned
 *  data/stations/<id>.sources.json, public/data/stations/index.json (which stations have an interior), and public/data/station-depths.json (every platform track's ends and rail
 *  height) from those interiors. Offline: the network is only used by fetch-station-sources.ts.
 *  The only IO here; the merge is scripts/lib/stationMerge.ts. Everything is built in memory first. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { StationInterior } from '../src/data/stationSchema.ts'
import type { AuthoredStation, GeneratedStation, StationSources } from './lib/stationInputs.ts'
import { checkBudget, checkIndexCap, committedGzip, GZIP_BUDGET_BYTES, INDEX_GZIP_CAP_BYTES, renderedFile } from './lib/budget.ts'
import { buildStationDepths } from './lib/stationDepths.ts'
import { buildStationIndex } from './lib/stationIndex.ts'
import { buildStationInterior } from './lib/stationMerge.ts'
import { markGenerated } from './lib/stationProvenance.ts'
import { toStableJson } from './lib/stableJson.ts'

const IN_DIR = new URL('../data/stations/', import.meta.url)
const OUT_DIR = new URL('../public/data/stations/', import.meta.url)
const DATA_DIR = new URL('../public/data/', import.meta.url)
const DEPTHS = 'station-depths.json'
const INDEX = 'index.json'
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

  // SEAM (9wc.4): the template generator fills this. A hand-authored station always wins over a generated one.
  const generated: GeneratedStation[] = []
  const authoredIds = new Set(ids)
  const skipped = generated.filter((g) => authoredIds.has(g.authored.stationId)).map((g) => g.authored.stationId)
  if (skipped.length > 0) console.log(`generated stations skipped (hand-authored wins): ${skipped.join(', ')}`)
  const generatedInteriors = generated
    .filter((g) => !authoredIds.has(g.authored.stationId))
    .map((g) => markGenerated(buildStationInterior(g.authored, g.sources), g.meta))
  const interiors = [...authoredInteriors, ...generatedInteriors]

  const depths = renderedFile(DEPTHS, toStableJson(buildStationDepths(interiors), 2))
  // index.json is fetched right after startup (not render-blocking, no waiting for a first focus), so it
  // isn't in this budget; it has its own cap instead.
  const index = renderedFile(INDEX, toStableJson(buildStationIndex(interiors), 2))
  checkIndexCap(index)
  // The client loads station-depths.json up front, so it shares the 60 KB budget with the GTFS files (the one limit).
  const total = checkBudget([depths], committedGzip(DATA_DIR, new Set([DEPTHS])))
  const files = interiors.map((interior) => ({ id: interior.stationId, json: toStableJson(interior, 2) }))
  mkdirSync(OUT_DIR, { recursive: true })
  for (const { id, json } of files) {
    writeFileSync(new URL(`${id}.json`, OUT_DIR), json)
    console.log(`stations/${id}.json: ${Buffer.byteLength(json)} bytes (${gzipSync(json).length} gzipped)`)
  }
  writeFileSync(new URL(INDEX, OUT_DIR), index.text)
  console.log(`stations/${INDEX}: ${index.raw} bytes (${index.gzip} gzipped, cap ${INDEX_GZIP_CAP_BYTES})`)
  writeFileSync(new URL(DEPTHS, DATA_DIR), depths.text)
  console.log(`${DEPTHS}: ${depths.raw} bytes (${depths.gzip} gzipped)`)
  console.log(`public/data total gzip: ${total} B (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
