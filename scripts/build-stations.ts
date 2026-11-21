/** Builds public/data/stations/<id>.json from data/stations/<id>.authored.json plus the pinned
 *  data/stations/<id>.sources.json, and public/data/station-depths.json (every platform track's ends and rail
 *  height) from those interiors. Offline: the network is only used by fetch-station-sources.ts.
 *  The only IO here; the merge is scripts/lib/stationMerge.ts. Everything is built in memory first. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { AuthoredStation, StationSources } from './lib/stationInputs.ts'
import { checkBudget, GZIP_BUDGET_BYTES, renderedFile } from './lib/budget.ts'
import { buildStationDepths } from './lib/stationDepths.ts'
import { buildStationInterior } from './lib/stationMerge.ts'
import { toStableJson } from './lib/stableJson.ts'

const IN_DIR = new URL('../data/stations/', import.meta.url)
const OUT_DIR = new URL('../public/data/stations/', import.meta.url)
const DATA_DIR = new URL('../public/data/', import.meta.url)
const DEPTHS = 'station-depths.json'
const SUFFIX = '.authored.json'
/** The client fetches station-depths.json on every load, so it stays small. */
const DEPTHS_GZIP_BUDGET_BYTES = 4_096

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T
}

function main(): void {
  const ids = readdirSync(IN_DIR)
    .filter((f) => f.endsWith(SUFFIX))
    .map((f) => f.slice(0, -SUFFIX.length))
    .sort()
  if (ids.length === 0) throw new Error(`No *${SUFFIX} files in ${IN_DIR.pathname}`)
  const interiors = ids.map((id) => {
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
  })
  const depths = renderedFile(DEPTHS, toStableJson(buildStationDepths(interiors), 2))
  if (depths.gzip > DEPTHS_GZIP_BUDGET_BYTES) {
    throw new Error(`${DEPTHS} is ${depths.gzip} B gzipped, over the ${DEPTHS_GZIP_BUDGET_BYTES} B budget`)
  }
  // It also counts toward the shared public/data budget with the GTFS files.
  const others: Record<string, number> = {}
  for (const name of readdirSync(DATA_DIR)) {
    if (name.endsWith('.json') && name !== DEPTHS) others[name] = gzipSync(readFileSync(new URL(name, DATA_DIR)), { level: 9 }).length
  }
  const total = checkBudget([depths], others)
  mkdirSync(OUT_DIR, { recursive: true })
  for (const interior of interiors) {
    const json = toStableJson(interior, 2)
    writeFileSync(new URL(`${interior.stationId}.json`, OUT_DIR), json)
    console.log(`stations/${interior.stationId}.json: ${Buffer.byteLength(json)} bytes (${gzipSync(json).length} gzipped)`)
  }
  writeFileSync(new URL(DEPTHS, DATA_DIR), depths.text)
  console.log(`${DEPTHS}: ${depths.raw} bytes (${depths.gzip} gzipped, budget ${DEPTHS_GZIP_BUDGET_BYTES})`)
  console.log(`public/data total gzip: ${total} B (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
