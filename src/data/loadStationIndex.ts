import { fetchJson } from './loadNetwork'
import type { StationIndex } from './stationSchema'

const PROVENANCE = ['authored', 'generated']
const FILE_ID = /^[A-Za-z0-9]+$/

/** Checks the shape of a fetched stations/index.json: an object of stations, each with a known provenance. */
export function expectStationIndex(raw: unknown, url: string): StationIndex {
  const fail = (why: string) => new Error(`${url}: not a station index (${why})`)
  if (typeof raw !== 'object' || raw === null) throw fail('not an object')
  const stations = (raw as Record<string, unknown>).stations
  if (typeof stations !== 'object' || stations === null || Array.isArray(stations)) throw fail('no stations object')
  const entries = stations as Record<string, unknown>
  for (const [id, entry] of Object.entries(entries)) {
    const fields = typeof entry === 'object' && entry !== null ? (entry as Record<string, unknown>) : undefined
    const provenance = fields?.provenance
    if (typeof provenance !== 'string' || !PROVENANCE.includes(provenance)) throw fail(`station ${id} has no valid provenance`)
    const file = fields?.file
    if (file === undefined) continue
    // A complex member's file id becomes a URL path segment, so it is a plain id naming a listed, non-alias entry.
    if (typeof file !== 'string' || !FILE_ID.test(file) || file === 'index') throw fail(`station ${id} has an invalid file`)
    if (file === id) throw fail(`station ${id} names itself as its file`)
    const target = Object.hasOwn(entries, file) ? entries[file] : undefined
    if (typeof target !== 'object' || target === null) throw fail(`station ${id} names an unlisted file ${file}`)
    if ((target as Record<string, unknown>).file !== undefined) throw fail(`station ${id} names ${file}, which is itself an alias`)
  }
  return raw as StationIndex
}

/** Fetches `<baseUrl>data/stations/index.json`: the ids that have an interior file. */
export async function loadStationIndex(baseUrl: string): Promise<StationIndex> {
  const url = `${baseUrl}data/stations/index.json`
  return expectStationIndex(await fetchJson(url), url)
}
