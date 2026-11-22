/** Refreshes data/stations/<id>.sources.json, the pinned source extracts for a station.
 *
 *  npm run data:stations:fetch -- --station L08
 *
 *  Uses the network (Overpass API and data.ny.gov SODA, both public and read-only), so it only runs
 *  by hand; CI and `npm run data:stations` stay offline. Responses are untrusted: they are validated
 *  and trimmed by scripts/lib/stationSources.ts, and nothing is written unless every request succeeds. */
import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import type { AuthoredStation, StationSources } from './lib/stationInputs.ts'
import { overpassQuery, trimOverpassLines, trimOverpassNodes } from './lib/stationOsmElements.ts'
import { dedupeEntrances, dedupeEquipment, epochToIso, rowsOfStops, sodaFilter, trimEntrances, trimEquipment, trimOverpassWays } from './lib/stationSources.ts'
import { toStableJson } from './lib/stableJson.ts'

const DIR = new URL('../data/stations/', import.meta.url)
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const SODA = 'https://data.ny.gov'
const HEADERS = { 'User-Agent': 'underground-data-build/1.0', Accept: 'application/json' }
const TIMEOUT_MS = 90_000
const ROW_LIMIT = 1000

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, { ...init, headers: { ...HEADERS, ...init.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url}: HTTP ${res.status} ${res.statusText}`)
  return res.json()
}

async function rowsUpdatedAt(dataset: string): Promise<string> {
  const meta = (await getJson(`${SODA}/api/views/${dataset}.json`)) as { rowsUpdatedAt?: unknown }
  return epochToIso(meta.rowsUpdatedAt, `${dataset} rowsUpdatedAt`)
}

function sodaUrl(dataset: string, filter: Record<string, string>): string {
  return `${SODA}/resource/${dataset}.json?${new URLSearchParams({ ...filter, $limit: String(ROW_LIMIT) })}`
}

/** A full page may have been cut off at the limit; refuse rather than pin a partial extract. */
function assertNotTruncated(rows: unknown, dataset: string): void {
  if (Array.isArray(rows) && rows.length >= ROW_LIMIT) throw new Error(`${dataset}: got ${rows.length} rows, the $limit; the extract may be truncated`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { station: { type: 'string' } }, strict: true })
  if (!values.station) throw new Error('Usage: npm run data:stations:fetch -- --station L08')
  const id = values.station
  const { fetch: wanted } = JSON.parse(readFileSync(new URL(`${id}.authored.json`, DIR), 'utf8')) as AuthoredStation

  const query = overpassQuery(wanted)
  const overpass = await getJson(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
  })
  const entrancesUrl = sodaUrl('i9wp-a4ja', sodaFilter('gtfs_stop_id', wanted.entrancesGtfsStopId, 'contains'))
  const equipmentUrl = sodaUrl('94fv-bak7', sodaFilter('station_mrn', wanted.equipmentStationMrn))
  const entranceRows = await getJson(entrancesUrl)
  const equipmentRows = await getJson(equipmentUrl)
  assertNotTruncated(entranceRows, 'i9wp-a4ja')
  assertNotTruncated(equipmentRows, '94fv-bak7')

  const osm = trimOverpassWays(overpass, wanted.osmWays)
  const lines = wanted.osmLines?.length ? trimOverpassLines(overpass, wanted.osmLines) : undefined
  const nodes = wanted.osmNodes?.length ? trimOverpassNodes(overpass, wanted.osmNodes) : undefined
  const sources: StationSources = {
    stationId: id,
    fetchedAt: new Date().toISOString(),
    osm: { license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors', query, ...osm, ...(lines ? { lines } : {}), ...(nodes ? { nodes } : {}) },
    entrances: { dataset: 'i9wp-a4ja', url: entrancesUrl, rowsUpdatedAt: await rowsUpdatedAt('i9wp-a4ja'), rows: dedupeEntrances(trimEntrances(rowsOfStops(entranceRows, wanted.entrancesGtfsStopId))) },
    equipment: { dataset: '94fv-bak7', url: equipmentUrl, rowsUpdatedAt: await rowsUpdatedAt('94fv-bak7'), rows: dedupeEquipment(trimEquipment(equipmentRows)) },
  }
  writeFileSync(new URL(`${id}.sources.json`, DIR), toStableJson(sources, 3))
  console.log(`${id}: ${sources.osm.ways.length} ways, ${lines?.length ?? 0} lines, ${nodes?.length ?? 0} nodes, ${sources.entrances.rows.length} entrance rows, ${sources.equipment.rows.length} equipment rows`)
  console.log('Review the diff of data/stations/, then run npm run data:stations')
}

await main()
