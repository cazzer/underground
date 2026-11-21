/** Everything the archetype classifier knows about one station, already in station-local meters
 *  (x east, z south, from any origin). Types only; the catalog adapter that fills them is a later step. */
import type { LatLon } from '../../src/lib/projection.ts'
import type { LocalPoint } from '../../src/data/stationSchema.ts'

export type Structure = 'subway' | 'elevated' | 'viaduct' | 'open-cut' | 'at-grade' | 'embankment'

export interface PlatformFact {
  osmWay: number
  /** Open ring (a repeated closing point is tolerated). */
  outline: LocalPoint[]
  /** Raw OSM `level` tag, or null when absent. May be "-2", "-1;-2", "B"; see parseOsmLevel. */
  levelTag: string | null
}

export interface TrackFact {
  /** The OSM way id or LRS id of the line, as in the source. Assigning GTFS child stop ids (L08N, L08S) to
   *  tracks by direction is the template step's job (9wc.4), not the classifier's. */
  ref: string
  source: 'osm' | 'lrs'
  /** A siding, spur or yard way (OSM tags an unused center track that way). */
  service?: boolean
  path: LocalPoint[]
}

export interface EquipmentFact {
  code: string
  kind: 'elevator' | 'escalator'
  /** E&E serving text, e.g. "mezzanine to platform for service in both directions". */
  serving: string
  /** E&E rise text (free-form feet and inches, or mm), when the dataset has one. */
  rise: string | null
  at: LocalPoint
}

export interface EntranceFact {
  at: LocalPoint
  type: string
}

export interface StationFacts {
  stationId: string
  name: string
  /** The lat/lon that every LocalPoint below is measured from (x east, z south), so a template can fill
   *  AuthoredStation.frame.anchor. */
  origin: LatLon
  structure: Structure
  /** A station complex (several stations sharing platforms or levels); never classified. */
  complex: boolean
  platforms: PlatformFact[]
  tracks: TrackFact[]
  equipment: EquipmentFact[]
  entrances: EntranceFact[]
  /** Platforms that another station point is also close to (one line each); the classifier deducts 0.1 once. */
  ambiguity?: string[]
}
