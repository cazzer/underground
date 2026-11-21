import { fetchJson } from './loadNetwork'
import type { StationInterior } from './stationSchema'

const ARRAY_KEYS = ['platforms', 'slabs', 'connectors', 'entrances', 'fareLines'] as const

/**
 * Checks the outer shape of a fetched interior file. Entries are trusted; the pipeline that
 * writes them is typed against stationSchema.ts.
 */
export function expectStationInterior(raw: unknown, id: string, url: string): StationInterior {
  const fail = () => new Error(`${url}: not a station interior for ${id}`)
  if (typeof raw !== 'object' || raw === null) throw fail()
  const r = raw as Record<string, unknown>
  const anchor = r.anchor as Record<string, unknown> | null | undefined
  if (
    r.stationId !== id ||
    typeof anchor !== 'object' ||
    anchor === null ||
    !Number.isFinite(anchor.lat) ||
    !Number.isFinite(anchor.lon) ||
    !Array.isArray(r.levels) ||
    r.levels.length === 0 ||
    ARRAY_KEYS.some((k) => !Array.isArray(r[k]))
  ) {
    throw fail()
  }
  return raw as StationInterior
}

/** Fetches `<baseUrl>data/stations/<id>.json` and checks its outer shape. */
export async function loadStationInterior(baseUrl: string, id: string): Promise<StationInterior> {
  const url = `${baseUrl}data/stations/${id}.json`
  return expectStationInterior(await fetchJson(url), id, url)
}
