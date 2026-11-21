/** Rebuilds the access fields (borough, ADA) of public/data/stations.json from the committed
 *  stations.json, the pinned catalog and data/stations/access-exceptions.json. Offline: use it after
 *  `npm run data:catalog:fetch` or an exceptions edit, instead of the full `npm run data`.
 *  Writes nothing if the join throws or the gzipped total is over budget. The only IO here. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import type { StationsFile } from '../src/data/schema.ts'
import { readAccessExceptions, readCatalogStations } from './lib/accessInputs.ts'
import { GZIP_BUDGET_BYTES, checkBudget, renderedFile } from './lib/budget.ts'
import { addAccess } from './lib/stationAccess.ts'
import { toStableJson } from './lib/stableJson.ts'

const DATA_DIR = new URL('../public/data/', import.meta.url)
const STATIONS = 'stations.json'

function main(): void {
  const file = JSON.parse(readFileSync(new URL(STATIONS, DATA_DIR), 'utf8')) as StationsFile
  const bare = file.stations.map(({ borough: _b, ada: _a, adaPartial: _p, ...rest }) => rest)
  const rebuilt = renderedFile(STATIONS, toStableJson({ ...file, stations: addAccess(bare, readCatalogStations(), readAccessExceptions()) }, 2))

  const others: Record<string, number> = {}
  for (const name of readdirSync(DATA_DIR)) {
    if (name.endsWith('.json') && name !== STATIONS) others[name] = gzipSync(readFileSync(new URL(name, DATA_DIR)), { level: 9 }).length
  }
  const total = checkBudget([rebuilt], others)
  writeFileSync(new URL(STATIONS, DATA_DIR), rebuilt.text)
  console.log(`${STATIONS}: ${rebuilt.raw} B raw, ${rebuilt.gzip} B gzip`)
  console.log(`Total gzip: ${total} B (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
