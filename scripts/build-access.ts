/** Rebuilds the access fields (borough, ADA) of public/data/stations.json from the committed
 *  stations.json, the pinned catalog and data/stations/access-exceptions.json. Offline: use it after
 *  `npm run data:catalog:fetch` or an exceptions edit, instead of the full `npm run data`.
 *  Writes nothing if the join throws or the gzipped total is over budget. The only IO here. */
import { readFileSync, writeFileSync } from 'node:fs'
import type { StationsFile } from '../src/data/schema.ts'
import { readAccessExceptions, readCatalogStations } from './lib/accessInputs.ts'
import { GZIP_BUDGET_BYTES, checkBudget, committedGzip, renderedFile } from './lib/budget.ts'
import { addAccess } from './lib/stationAccess.ts'
import { toStableJson } from './lib/stableJson.ts'

const DATA_DIR = new URL('../public/data/', import.meta.url)
const STATIONS = 'stations.json'

function main(): void {
  const file = JSON.parse(readFileSync(new URL(STATIONS, DATA_DIR), 'utf8')) as StationsFile
  const bare = file.stations.map(({ borough: _b, ada: _a, adaPartial: _p, ...rest }) => rest)
  const access = addAccess(bare, readCatalogStations(), readAccessExceptions())
  if (access.warnings.length > 0) throw new Error(`Stale access exceptions (nothing written):\n  ${access.warnings.join('\n  ')}`)
  const rebuilt = renderedFile(STATIONS, toStableJson({ ...file, stations: access.stations }, 2))

  const total = checkBudget([rebuilt], committedGzip(DATA_DIR, new Set([STATIONS])))
  writeFileSync(new URL(STATIONS, DATA_DIR), rebuilt.text)
  console.log(`${STATIONS}: ${rebuilt.raw} B raw, ${rebuilt.gzip} B gzip`)
  console.log(`Total gzip: ${total} B (budget ${GZIP_BUDGET_BYTES} B)`)
}

main()
