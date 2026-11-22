import { fetchJson } from './loadNetwork'
import type { StationInterior } from './stationSchema'

const MEMBER_ID = /^[A-Za-z0-9]+$/
const ARRAY_KEYS = ['platforms', 'slabs', 'connectors', 'entrances', 'fareLines'] as const

/**
 * Checks the outer shape of a fetched interior file. Entries are trusted; the pipeline that
 * writes them is typed against stationSchema.ts. `id` is the file id: a complex's file is named after, and its
 * stationId and first member are, its first member.
 */
export function expectStationInterior(raw: unknown, id: string, url: string): StationInterior {
  const fail = () => new Error(`${url}: not a station interior for ${id}`)
  if (typeof raw !== 'object' || raw === null) throw fail()
  const r = raw as Record<string, unknown>
  const anchor = r.anchor as Record<string, unknown> | null | undefined
  const members = r.memberStationIds
  if (
    members !== undefined &&
    (!Array.isArray(members) ||
      members.length < 2 ||
      members.some((m) => typeof m !== 'string' || !MEMBER_ID.test(m)) ||
      new Set(members).size !== members.length ||
      members[0] !== id)
  ) {
    throw fail()
  }
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
