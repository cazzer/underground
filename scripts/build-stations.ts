/** Builds public/data/stations/<id>.json from data/stations/<id>.authored.json plus the pinned
 *  data/stations/<id>.sources.json. Offline: the network is only used by fetch-station-sources.ts.
 *  The only IO here; the merge is scripts/lib/stationMerge.ts. Everything is built in memory first. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { AuthoredStation, StationSources } from './lib/stationInputs.ts'
import { buildStationInterior } from './lib/stationMerge.ts'
import { toStableJson } from './lib/stableJson.ts'

const IN_DIR = new URL('../data/stations/', import.meta.url)
const OUT_DIR = new URL('../public/data/stations/', import.meta.url)
const SUFFIX = '.authored.json'

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T
}

function main(): void {
  const ids = readdirSync(IN_DIR)
    .filter((f) => f.endsWith(SUFFIX))
    .map((f) => f.slice(0, -SUFFIX.length))
    .sort()
  if (ids.length === 0) throw new Error(`No *${SUFFIX} files in ${IN_DIR.pathname}`)
  const outputs = ids.map((id): [string, string] => {
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
    return [`${id}.json`, toStableJson(buildStationInterior(authored, sources), 2)]
  })
  mkdirSync(OUT_DIR, { recursive: true })
  for (const [name, json] of outputs) {
    writeFileSync(new URL(name, OUT_DIR), json)
    console.log(`stations/${name}: ${Buffer.byteLength(json)} bytes (${gzipSync(json).length} gzipped)`)
  }
}

main()
