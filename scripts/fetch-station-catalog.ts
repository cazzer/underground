/** Pins citywide station data into data/stations/catalog/ (stations, entrances, equipment, amenities, envelopes, osm-platforms, osm-tracks).
 *
 *  npm run data:catalog:fetch
 *  npm run data:catalog:fetch -- --only amenities.json   (re-pins that one file; every other catalog file is left alone)
 *
 *  Uses the network (data.ny.gov SODA and the Overpass API, both public and read-only), so it only runs
 *  by hand; CI and `npm run data:stations` stay offline and never read these files. Responses are
 *  untrusted: they are validated and trimmed by scripts/lib/catalog*.ts, and nothing is written unless
 *  every request succeeds and the sizes are within budget.
 *
 *  Never add the 2021 draft NYCT GTFS-Pathways feed to this catalog: the MTA says not to use it in
 *  public-facing applications (docs/research/station-modeling.md). The DOS Track LRS (dyuj-5if7) is a
 *  file geodatabase only, so OSM railway=subway ways are the track source. */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { assertRowCount, parseCount, parseLatestMonth, parseViewMeta, trimCatalogAmenities, trimCatalogEntrances, trimCatalogEquipment, trimCatalogStations } from './lib/catalogSoda.ts'
import { trimEnvelopes } from './lib/catalogEnvelopes.ts'
import { catalogBbox, trimOverpassCatalog } from './lib/catalogOsm.ts'
import { OPEN_NY_TERMS } from './lib/catalogTypes.ts'
import type { SodaHeader } from './lib/catalogTypes.ts'
import { getJson } from './lib/fetchJson.ts'
import { toStableJson } from './lib/stableJson.ts'

const DIR = new URL('../data/stations/catalog/', import.meta.url)
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const SODA = 'https://data.ny.gov'
const OVERPASS_TIMEOUT_MS = 240_000
const ROW_LIMIT = 5000
const RADII = { platformRadiusM: 250, trackRadiusM: 300 }
const MAX_FILE_BYTES = 2_000_000
const MAX_TOTAL_BYTES = 5_000_000

const AMENITIES = '6yjv-fk7g'
const AMENITIES_FILE = 'amenities.json'

/** The `--only <file>` argument: `amenities.json` to re-pin that one file, null for all of them. */
function onlyArg(argv: string[]): string | null {
  const at = argv.indexOf('--only')
  if (at < 0) return null
  const name = argv[at + 1]
  if (name !== AMENITIES_FILE) throw new Error(`--only takes ${AMENITIES_FILE} (the other files are pinned together), got ${JSON.stringify(name)}`)
  return name
}

/** Header plus the exact rows: count(*) first, then everything in one page; the counts must agree. A `where`
 *  (SoQL) filters both the count and the rows, and is part of the recorded `url`. */
async function fetchDataset(dataset: string, ext: 'json' | 'geojson', where?: string): Promise<{ header: SodaHeader; rows: unknown }> {
  const meta = parseViewMeta(await getJson(`${SODA}/api/views/${dataset}.json`), dataset)
  const countQuery = new URLSearchParams({ $select: 'count(*)', ...(where === undefined ? {} : { $where: where }) })
  const count = parseCount(await getJson(`${SODA}/resource/${dataset}.json?${countQuery}`), dataset)
  const rowQuery = new URLSearchParams({ ...(where === undefined ? {} : { $where: where }), $limit: String(ROW_LIMIT) })
  const url = `${SODA}/resource/${dataset}.${ext}?${rowQuery}`
  if (count >= ROW_LIMIT) throw new Error(`${dataset}: ${count} rows is not below the $limit of ${ROW_LIMIT}`)
  const rows = await getJson(url)
  assertRowCount(ext === 'geojson' ? (rows as { features?: unknown }).features : rows, count, dataset)
  const header: SodaHeader = { dataset, ...meta, url, fetchedAt: new Date().toISOString(), terms: OPEN_NY_TERMS, count }
  return { header, rows }
}

/** Restrooms of the latest month only: the dataset keeps every month's snapshot (about 115 restrooms each). */
async function pinAmenities(): Promise<Record<string, unknown>> {
  const type = "amenity_type='PUBLIC_RESTROOM'"
  const latest = await getJson(`${SODA}/resource/${AMENITIES}.json?${new URLSearchParams({ $select: 'max(month)', $where: type })}`)
  const month = parseLatestMonth(latest, AMENITIES)
  const data = await fetchDataset(AMENITIES, 'json', `${type} AND month='${month}'`)
  return { [AMENITIES_FILE]: { ...data.header, rows: trimCatalogAmenities(data.rows) } }
}

async function main(): Promise<void> {
  const only = onlyArg(process.argv.slice(2))
  const files = only === null ? await pinAll() : await pinAmenities()
  const rendered = Object.entries(files).map(([name, value]) => ({ name, text: toStableJson(value, 2) }))
  let total = 0
  for (const { name, text } of rendered) {
    const bytes = Buffer.byteLength(text)
    total += bytes
    console.log(`${name}: ${(bytes / 1000).toFixed(0)} KB`)
    if (bytes > MAX_FILE_BYTES) throw new Error(`${name} is ${bytes} bytes, over the ${MAX_FILE_BYTES} byte budget; nothing written`)
  }
  console.log(`total: ${(total / 1000).toFixed(0)} KB${only === null ? '' : ` (${only} only; the other catalog files are not counted)`}`)
  if (total > MAX_TOTAL_BYTES) throw new Error(`catalog is ${total} bytes, over the ${MAX_TOTAL_BYTES} byte budget; nothing written`)
  mkdirSync(DIR, { recursive: true })
  for (const { name, text } of rendered) writeFileSync(new URL(`${name}.tmp`, DIR), text)
  for (const { name } of rendered) renameSync(new URL(`${name}.tmp`, DIR), new URL(name, DIR))
  console.log('Review the diff of data/stations/catalog/')
}

async function pinAll(): Promise<Record<string, unknown>> {
  const stationData = await fetchDataset('39hk-dx4f', 'json')
  const stations = trimCatalogStations(stationData.rows)
  const entranceData = await fetchDataset('i9wp-a4ja', 'json')
  const equipmentData = await fetchDataset('94fv-bak7', 'json')
  const amenities = await pinAmenities()
  const envelopeData = await fetchDataset('vkng-7ivg', 'geojson')
  const envelopes = trimEnvelopes(envelopeData.rows)

  const bbox = catalogBbox(stations)
  const query =
    `[out:json][timeout:180][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];` +
    '(way["railway"="platform"];way["railway"="subway"];);out geom;relation["railway"="platform"];out ids;'
  const overpass = await getJson(
    OVERPASS_URL,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: query }) },
    OVERPASS_TIMEOUT_MS,
  )
  const osm = trimOverpassCatalog(overpass, stations, RADII)

  const osmHeader = {
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    fetchedAt: new Date().toISOString(),
    baseTimestamp: osm.baseTimestamp,
    query,
    platformRadiusM: RADII.platformRadiusM,
    trackRadiusM: RADII.trackRadiusM,
  }
  const files: Record<string, unknown> = {
    'stations.json': { ...stationData.header, rows: stations },
    'entrances.json': { ...entranceData.header, rows: trimCatalogEntrances(entranceData.rows) },
    'equipment.json': { ...equipmentData.header, rows: trimCatalogEquipment(equipmentData.rows) },
    ...amenities,
    'envelopes.json': { ...envelopeData.header, kept: envelopes.length, rows: envelopes },
    'osm-platforms.json': { ...osmHeader, skippedRelations: osm.skippedRelations, ways: osm.platforms },
    'osm-tracks.json': { ...osmHeader, ways: osm.tracks },
  }
  console.log(`${stations.length} stations, ${osm.platforms.length} OSM platform and ${osm.tracks.length} track ways, ${osm.skippedRelations.length} platform relations skipped, ${envelopes.length} NYCT envelopes`)
  return files
}

await main()
