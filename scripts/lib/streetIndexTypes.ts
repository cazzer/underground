/** What scripts/lib/streetIndex.ts builds before packing (2q7.13): one entry per street and per intersection, with the
 *  station each site is nearest to. The packed form the Worker reads is worker/src/streetIndexSchema.ts. */
import type { Borough, StationId } from '../../src/data/schema.ts'
import type { StreetRank } from '../../worker/src/streetIndexSchema.ts'

export type { StreetRank }

/** [lat, lon, station]: WGS84 rounded to 5 decimals (about 1 m); station = the stations.json station nearest the point. */
export type SearchSite = [lat: number, lon: number, station: StationId]

export interface StreetEntry {
  kind: 'street'
  name: string
  borough: Borough
  rank: StreetRank
  sites: SearchSite[]
}

export interface IntersectionEntry {
  kind: 'intersection'
  names: [string, string]
  borough: Borough
  rank: StreetRank
  site: SearchSite
}

export type StreetSearchEntry = StreetEntry | IntersectionEntry
