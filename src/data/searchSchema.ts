/** Contract for public/data/search/streets/<bucket>.json: the citywide street and intersection search shards. Built by
 *  scripts/build-street-index.ts (2q7.13) from the pinned OSM street extract; read by the search client (2q7.14). Change
 *  both sides together. Type-only imports with .ts paths so Node can run the scripts that load this file.
 *
 *  The bucket rule (src/lib/searchBucket.ts) is the other half of the contract: the client hashes the first two
 *  characters of the query's first distinctive token to one hex file name, so no street name is ever in a URL.
 *
 *  Rules the builder keeps, so the client can rely on them:
 *  - A street name is the display name: it tokenizes to the same `streetKey` as the OSM name ("North 7th Street" and
 *    "N 7th St" are one street, "N 7 St"). `sites` has, for each station among the street's vertices' nearest stations,
 *    the point on the street nearest that station, sorted by station id.
 *  - Intersection `names` are the two display names, the higher `rank` first then by name (code-unit order), each equal
 *    to a `StreetEntry.name` in the same borough; its `rank` is the lower of the two. Its `site` is the shared node
 *    nearest the mean of those within 100 m of each other (so the site is on both streets), so two carriageways crossing
 *    are one intersection.
 *  - Uniqueness: streets by (borough, name); intersections by (borough, names, site lat/lon).
 *  - No ids are stored: an entry has the same fields in every bucket it is filed in.
 *  - Entry order: streets, then intersections, each by display text (the name, or the names joined with " & "), then
 *    borough, then site latitude and longitude.
 *  - Coverage is the streets within 300 m of a station point (the pin). The borough is the nearest station's, which can
 *    be wrong on a land border. A site's station is the stations.json station nearest the point; a client ignores a
 *    station id it does not know, so the envelope carries no feedVersion. */
import type { Borough, StationId } from './schema.ts'

/** [lat, lon, station]: WGS84 rounded to 5 decimals (about 1 m); station = the stations.json station nearest the point. */
export type SearchSite = [lat: number, lon: number, station: StationId]

/** Best highway class of the street: 4 trunk/primary, 3 secondary, 2 tertiary, 1 residential, unclassified,
 *  living_street or pedestrian, 0 service (a `*_link` ranks as its base class). */
export type StreetRank = 0 | 1 | 2 | 3 | 4

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

/** 2q7.15 adds 'addresses' and 'places'. */
export type SearchFamily = 'streets'

export interface SearchShardBase {
  format: 1
  family: SearchFamily
  /** This file's bucket, 0 to `buckets` - 1; the file is `bucketFileName(bucket)`. */
  bucket: number
  buckets: number
  attribution: string[]
}

export interface StreetSearchShard extends SearchShardBase {
  family: 'streets'
  license: 'ODbL-1.0'
  /** The pin's OSM base timestamp. */
  osmTimestamp: string
  entries: StreetSearchEntry[]
}

/** The union grows with 2q7.15. */
export type SearchShard = StreetSearchShard
