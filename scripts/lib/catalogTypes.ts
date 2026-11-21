/** Shapes of the files in data/stations/catalog/ (written by scripts/fetch-station-catalog.ts).
 *  The grouping keys are shared across files: `gtfsStopId` is the GTFS parent stop, `stationId` is
 *  the MTA station id in 39hk-dx4f (the same number as the E&E station MRN, without leading zeros),
 *  and `complexId` groups the stations of one complex. */
import type { EntranceRow } from './stationInputs.ts'

export const OPEN_NY_TERMS = 'OPEN-NY Terms of Use (2013-03-08)'

/** Provenance of one data.ny.gov dataset, from its view metadata. */
export interface SodaHeader {
  dataset: string
  title: string
  url: string
  rowsUpdatedAt: string
  fetchedAt: string
  attribution: string
  attributionLink: string
  terms: typeof OPEN_NY_TERMS
  /** Rows the dataset held (`count(*)`) when fetched; the fetch fails unless this many came back. */
  count: number
}

export const STRUCTURES = ['Subway', 'Elevated', 'Open Cut', 'Viaduct', 'At Grade', 'Embankment'] as const

/** Sorted by gtfsStopId. */
export interface CatalogStation {
  gtfsStopId: string
  stationId: string
  complexId: string
  division: string
  line: string
  name: string
  borough: string
  routes: string[]
  structure: (typeof STRUCTURES)[number]
  lat: number
  lon: number
  /** 0 not accessible, 1 fully, 2 partially (see adaNotes). */
  ada: number
  adaNorth: boolean
  adaSouth: boolean
  adaNotes: string | null
  northLabel: string
  southLabel: string
}

/** One entrance row; the source lists a station's shared stop ids as "A32; D20". Sorted by stationId, lat, lon. */
export interface CatalogEntrance extends EntranceRow {
  gtfsStopIds: string[]
  stationId: string
  complexId: string
}

/** Sorted by code. Access flags are null where the source has none (escalators, freight). */
export interface CatalogEquipment {
  code: string
  kind: 'elevator' | 'escalator'
  /** False for yard and freight machines. */
  revenue: boolean
  stationId: string | null
  complexId: string | null
  lat: number | null
  lon: number | null
  serving: string | null
  /** Raw text with mixed units, e.g. `10' - 9 7/8in`. */
  rise: string | null
  landings: string | null
  direction: string | null
  ada: boolean | null
  streetAccess: boolean | null
  mezzanine1Access: boolean | null
  mezzanine2Access: boolean | null
  platformAccess: boolean | null
}

/** Rings are [lat, lon] pairs, closed (first point repeated last); a polygon's holes follow its outer ring. */
export interface CatalogEnvelope {
  shapeId: string
  name: string
  division: string | null
  borough: string | null
  agency: string
  rings: [number, number][][]
}

export interface OsmCatalogWay {
  id: number
  version: number
  tags: Record<string, string>
  closed: boolean
  points: [lat: number, lon: number][]
}
