/** Pins citywide station data into data/stations/catalog/ (stations, entrances, equipment, envelopes, osm-platforms, osm-tracks).
 *
 *  npm run data:catalog:fetch
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
import { assertRowCount, parseCount, parseViewMeta, trimCatalogEntrances, trimCatalogEquipment, trimCatalogStations } from './lib/catalogSoda.ts'
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

/** Header plus the exact rows: count(*) first, then everything in one page; the counts must agree. */
async function fetchDataset(dataset: string, ext: 'json' | 'geojson'): Promise<{ header: SodaHeader; rows: unknown }> {
  const meta = parseViewMeta(await getJson(`${SODA}/api/views/${dataset}.json`), dataset)
  const count = parseCount(await getJson(`${SODA}/resource/${dataset}.json?${new URLSearchParams({ $select: 'count(*)' })}`), dataset)
  const url = `${SODA}/resource/${dataset}.${ext}?${new URLSearchParams({ $limit: String(ROW_LIMIT) })}`
  if (count >= ROW_LIMIT) throw new Error(`${dataset}: ${count} rows is not below the $limit of ${ROW_LIMIT}`)
  const rows = await getJson(url)
  assertRowCount(ext === 'geojson' ? (rows as { features?: unknown }).features : rows, count, dataset)
  const header: SodaHeader = { dataset, ...meta, url, fetchedAt: new Date().toISOString(), terms: OPEN_NY_TERMS, count }
  return { header, rows }
}

async function main(): Promise<void> {
  const stationData = await fetchDataset('39hk-dx4f', 'json')
  const stations = trimCatalogStations(stationData.rows)
  const entranceData = await fetchDataset('i9wp-a4ja', 'json')
  const equipmentData = await fetchDataset('94fv-bak7', 'json')
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
    'envelopes.json': { ...envelopeData.header, kept: envelopes.length, rows: envelopes },
    'osm-platforms.json': { ...osmHeader, skippedRelations: osm.skippedRelations, ways: osm.platforms },
    'osm-tracks.json': { ...osmHeader, ways: osm.tracks },
  }
  const rendered = Object.entries(files).map(([name, value]) => ({ name, text: toStableJson(value, 2) }))
  let total = 0
  for (const { name, text } of rendered) {
    const bytes = Buffer.byteLength(text)
    total += bytes
    console.log(`${name}: ${(bytes / 1000).toFixed(0)} KB`)
    if (bytes > MAX_FILE_BYTES) throw new Error(`${name} is ${bytes} bytes, over the ${MAX_FILE_BYTES} byte budget; nothing written`)
  }
  console.log(`total: ${(total / 1000).toFixed(0)} KB`)
  if (total > MAX_TOTAL_BYTES) throw new Error(`catalog is ${total} bytes, over the ${MAX_TOTAL_BYTES} byte budget; nothing written`)
  mkdirSync(DIR, { recursive: true })
  for (const { name, text } of rendered) writeFileSync(new URL(`${name}.tmp`, DIR), text)
  for (const { name } of rendered) renameSync(new URL(`${name}.tmp`, DIR), new URL(name, DIR))
  console.log(`${stations.length} stations, ${osm.platforms.length} OSM platform and ${osm.tracks.length} track ways, ${osm.skippedRelations.length} platform relations skipped, ${envelopes.length} NYCT envelopes`)
  console.log('Review the diff of data/stations/catalog/')
}

await main()
