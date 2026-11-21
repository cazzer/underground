import { fetchJson } from './loadNetwork'
import type { StationIndex } from './stationSchema'

const PROVENANCE = ['authored', 'generated']

/** Checks the shape of a fetched stations/index.json: an object of stations, each with a known provenance. */
export function expectStationIndex(raw: unknown, url: string): StationIndex {
  const fail = (why: string) => new Error(`${url}: not a station index (${why})`)
  if (typeof raw !== 'object' || raw === null) throw fail('not an object')
  const stations = (raw as Record<string, unknown>).stations
  if (typeof stations !== 'object' || stations === null || Array.isArray(stations)) throw fail('no stations object')
  for (const [id, entry] of Object.entries(stations)) {
    const provenance = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>).provenance : undefined
    if (typeof provenance !== 'string' || !PROVENANCE.includes(provenance)) throw fail(`station ${id} has no valid provenance`)
  }
  return raw as StationIndex
}

/** Fetches `<baseUrl>data/stations/index.json`: the ids that have an interior file. */
export async function loadStationIndex(baseUrl: string): Promise<StationIndex> {
  const url = `${baseUrl}data/stations/index.json`
  return expectStationIndex(await fetchJson(url), url)
}
