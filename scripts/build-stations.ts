/** Builds public/data/stations/<id>.json from data/stations/<id>.authored.json plus the pinned
 *  data/stations/<id>.sources.json, and public/data/station-depths.json (every platform track's ends and rail
 *  height) from those interiors. Offline: the network is only used by fetch-station-sources.ts.
 *  The only IO here; the merge is scripts/lib/stationMerge.ts. Everything is built in memory first. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { AuthoredStation, StationSources } from './lib/stationInputs.ts'
import { buildStationDepths } from './lib/stationDepths.ts'
import { buildStationInterior } from './lib/stationMerge.ts'
import { toStableJson } from './lib/stableJson.ts'

const IN_DIR = new URL('../data/stations/', import.meta.url)
const OUT_DIR = new URL('../public/data/stations/', import.meta.url)
const DEPTHS_URL = new URL('../public/data/station-depths.json', import.meta.url)
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
  const depths = toStableJson(buildStationDepths(interiors), 2)
  const depthsGzip = gzipSync(depths, { level: 9 }).length
  if (depthsGzip > DEPTHS_GZIP_BUDGET_BYTES) {
    throw new Error(`station-depths.json is ${depthsGzip} B gzipped, over the ${DEPTHS_GZIP_BUDGET_BYTES} B budget`)
  }
  mkdirSync(OUT_DIR, { recursive: true })
  for (const interior of interiors) {
    const json = toStableJson(interior, 2)
    writeFileSync(new URL(`${interior.stationId}.json`, OUT_DIR), json)
    console.log(`stations/${interior.stationId}.json: ${Buffer.byteLength(json)} bytes (${gzipSync(json).length} gzipped)`)
  }
  writeFileSync(DEPTHS_URL, depths)
  console.log(`station-depths.json: ${Buffer.byteLength(depths)} bytes (${depthsGzip} gzipped, budget ${DEPTHS_GZIP_BUDGET_BYTES})`)
}

main()
