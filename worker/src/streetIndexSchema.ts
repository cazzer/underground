/** Contract for worker/data/streetIndex.json: the citywide street and intersection index the Worker's /geocode searches
 *  (2q7.14). Built by scripts/build-street-index.ts (2q7.13) from the pinned OSM street extract; read by
 *  worker/src/streetIndex.ts. Change both sides together. Types and constants only (never import the JSON here: the
 *  client may import this file, and must not bundle the index). Imports use `.ts` paths so Node can run the scripts.
 *
 *  Rules the builder keeps, so the Worker can rely on them:
 *  - A street name is the display name ("North 7th Street" is "N 7 St"), no two streets share (borough, name), and a name
 *    never contains ", " (the result label is "<name>, <borough>"). `sites` are WGS84 rounded to 5 decimals (about 1 m):
 *    for each station among the street's vertices' nearest stations, the point on the street nearest that station.
 *  - An intersection is two different streets of one borough, `first` the higher class (then the name in code-unit
 *    order); its site is the shared node nearest the mean of those within 100 m of each other, so it is on both streets.
 *  - `keys` is the key rule of streetKeys.ts applied to every street (`entryKeys([name])`): sorted by key, each key once,
 *    its street indices sorted ascending and unique. A query side reads only the one key `queryKey` gives, and so scores
 *    only those streets; an intersection is found through its two streets, so it has no keys of its own.
 *  - Order: streets by name (code-unit order), then borough, then first site; intersections by their "A & B" text, then
 *    borough, then site.
 *  - Coverage is the streets within 300 m of a station point (the pin). The borough is the nearest station's, which can
 *    be wrong on a land border. */

export const STREET_INDEX_FORMAT = 2

export type IndexBorough = 'Bx' | 'M' | 'Bk' | 'Q' | 'SI'

/** The names the result labels carry, as GeoSearch writes them. */
export const BOROUGH_NAMES: Readonly<Record<IndexBorough, string>> = {
  Bx: 'Bronx',
  M: 'Manhattan',
  Bk: 'Brooklyn',
  Q: 'Queens',
  SI: 'Staten Island',
}

/** Best highway class of the street: 4 trunk/primary, 3 secondary, 2 tertiary, 1 residential, unclassified,
 *  living_street or pedestrian, 0 service (a `*_link` ranks as its base class). */
export type StreetRank = 0 | 1 | 2 | 3 | 4

/** [lat, lon], 5 decimals. */
export type IndexSite = [lat: number, lon: number]

export type StreetRow = [name: string, borough: IndexBorough, rank: StreetRank, sites: IndexSite[]]

/** Indices into `streets`; both streets are in the same borough. */
export type CrossingRow = [first: number, second: number, site: IndexSite]

/** A two-character key and the streets filed under it. */
export type KeyRow = [key: string, streets: number[]]

export interface StreetIndexFile {
  format: typeof STREET_INDEX_FORMAT
  license: 'ODbL-1.0'
  attribution: string
  /** The pin's OSM base timestamp. */
  osmTimestamp: string
  streets: StreetRow[]
  intersections: CrossingRow[]
  keys: KeyRow[]
}
