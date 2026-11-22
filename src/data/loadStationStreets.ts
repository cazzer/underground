import { fetchJson, HttpError } from './loadNetwork'
import type { StationStreets } from './streetSchema'

/**
 * Checks the outer shape of a fetched street file: its station and anchor, format 1, its two radii (walk within
 * street), a node table of three equal-length arrays, and the way and entrance arrays. Entries are trusted; the build that writes them is typed
 * against streetSchema.ts.
 */
export function expectStationStreets(raw: unknown, id: string, url: string): StationStreets {
  const fail = () => new Error(`${url}: not a street file for ${id}`)
  if (typeof raw !== 'object' || raw === null) throw fail()
  const r = raw as Record<string, unknown>
  const anchor = r.anchor as Record<string, unknown> | null | undefined
  const { nodeId, x, z, radiusM, walkRadiusM } = r
  if (
    r.stationId !== id ||
    typeof anchor !== 'object' ||
    anchor === null ||
    !Number.isFinite(anchor.lat) ||
    !Number.isFinite(anchor.lon) ||
    r.format !== 1 ||
    typeof radiusM !== 'number' ||
    typeof walkRadiusM !== 'number' ||
    !(radiusM > 0) ||
    !(walkRadiusM > 0 && walkRadiusM <= radiusM) ||
    !Array.isArray(nodeId) ||
    !Array.isArray(x) ||
    !Array.isArray(z) ||
    x.length !== nodeId.length ||
    z.length !== nodeId.length ||
    !Array.isArray(r.ways) ||
    !Array.isArray(r.entrances)
  ) {
    throw fail()
  }
  return raw as StationStreets
}

/**
 * Fetches `<baseUrl>data/streets/<id>.json` and checks its outer shape. A station with no street file (404) gives
 * null, with one warning; any other failure rejects.
 */
export async function loadStationStreets(baseUrl: string, id: string): Promise<StationStreets | null> {
  const url = `${baseUrl}data/streets/${id}.json`
  let raw: unknown
  try {
    raw = await fetchJson(url)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      console.warn(`No street file for station ${id} (${url})`)
      return null
    }
    throw err
  }
  return expectStationStreets(raw, id, url)
}
