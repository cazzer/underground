/** Input types for scripts/build-stations.ts and scripts/fetch-station-sources.ts. Not shipped. */
import type { LatLon } from '../../src/lib/projection.ts'
import type { DepthSource, GeneratedInfo, Level, LevelId } from '../../src/data/stationSchema.ts'

/** [u, v] meters: u along frame.bearingDeg (clockwise from north) from the anchor, v to its right. */
export type FramePoint = [u: number, v: number]

/** data/stations/<id>.authored.json, hand-edited. */
export interface AuthoredStation {
  stationId: string
  /** A station complex: every member's GTFS station id, sorted, `stationId` first (the file is named after it). */
  memberStationIds?: string[]
  name: string
  /** Free text. Facts not confirmed by a source start with "UNVERIFIED:". Not copied to output. */
  notes: string[]
  frame: { anchor: LatLon; bearingDeg: number }
  /** What fetch-station-sources pulls; a complex lists one value per member. */
  fetch: {
    osmWays: number[]
    /** Open or closed OSM ways to pin as lines (stairs, escalator ways), cited by `osmRef` ("way/N"). Absent for most stations. */
    osmLines?: number[]
    /** OSM nodes to pin as points (a street elevator), cited by `osmRef` ("node/N"). */
    osmNodes?: number[]
    entrancesGtfsStopId: string | string[]
    equipmentStationMrn: string | string[]
  }
  levels: Level[]
  platforms: { id: string; level: LevelId; osmWay: number; tracks: { stopId: string; path: FramePoint[] }[] }[]
  slabs: { id: string; level: LevelId; name: string; outline: FramePoint[]; paid?: boolean }[]
  /** Must cover every Open Data row exactly once; matched by the row's exact lat/lon (tolerance 1e-6 deg). */
  entrances: { id: string; source: [lat: number, lon: number] }[]
  /** Stairs, ramps and walkways (no source provides them). Escalators/elevators come from E&E. */
  connectors: AuthoredConnector[]
  /** Per-machine corrections to E&E rows, keyed by equipment code. */
  equipment: EquipmentOverride[]
  fareLines: { id: string; level: LevelId; path: FramePoint[] }[]
}
/** `entrance` resolves to the entrance point at the street level: the upper end below ground, the lower end
 *  at an elevated station (the lower end must still be below the upper end). */
export type AuthoredEnd = { level: LevelId; at: FramePoint; area?: string } | { entrance: string }
export interface AuthoredConnector {
  id: string
  kind: 'stair' | 'ramp' | 'walkway'
  width: number
  lower: AuthoredEnd
  upper: AuthoredEnd
  /** "way/N" or "node/N" of a pinned OSM line, way or node this connector follows (adds 'osm' to sources and writes
   *  `osmRef`). At least one `at` end (not an entrance end) must lie within 1 m of it. */
  osmRef?: string
}
export interface EquipmentOverride {
  code: string
  /** Replaces the E&E position (adds 'authored' to sources). */
  at?: FramePoint
  /** Escalators only, instead of `at`: the lower and upper plan ends (by elevation), giving it a run of its own
   *  (adds 'authored'). A street end with an `entrance` sits on the entrance point whatever is given for it. */
  ends?: { lower: FramePoint; upper: FramePoint }
  /** Street entrance this machine serves (one of its two levels must be the street). Without `at`, the
   *  machine sits at the entrance point. */
  entrance?: string
  /** Required when the station has two levels of the same kind (e.g. Hudson Yards). */
  levels?: { lower: LevelId; upper: LevelId }
  width?: number
  /** "way/N" or "node/N" of a pinned OSM element this machine sits on (adds 'osm' to sources and writes `osmRef`).
   *  Needs `at` or `ends`; one authored point must lie within 1 m of the element. */
  osmRef?: string
}

/** What a template generator knows about a station beyond its authored-shaped geometry. */
export interface GeneratedMeta {
  archetype: GeneratedInfo['archetype']
  confidence: number
  /** Where each non-street level's depth came from. */
  levelDepths: Record<LevelId, DepthSource>
}
/** A generated station: the same inputs as a hand-authored one, plus its provenance. */
export interface GeneratedStation {
  authored: AuthoredStation
  sources: StationSources
  meta: GeneratedMeta
}

/** data/stations/<id>.sources.json: pinned extracts written by fetch-station-sources.ts. */
export interface StationSources {
  stationId: string
  fetchedAt: string // ISO
  osm: {
    license: 'ODbL-1.0'
    attribution: '© OpenStreetMap contributors'
    query: string
    baseTimestamp: string
    ways: OsmWay[]
    /** Pinned open or closed ways, only for stations whose `fetch` lists `osmLines`. */
    lines?: OsmLine[]
    /** Pinned nodes, only for stations whose `fetch` lists `osmNodes`. */
    nodes?: OsmNode[]
  }
  entrances: { dataset: 'i9wp-a4ja'; url: string; rowsUpdatedAt: string; rows: EntranceRow[] }
  equipment: { dataset: '94fv-bak7'; url: string; rowsUpdatedAt: string; rows: EquipmentRow[] }
}
export interface OsmWay {
  id: number
  /** Present in per-station fetches (`out geom meta`); the catalog was fetched without meta. The merge never reads them. */
  version?: number
  timestamp?: string
  tags: Record<string, string>
  ring: [lat: number, lon: number][]
}
/** A way pinned as a polyline (at least 2 points; closed when the first point equals the last). Meta is always present. */
export interface OsmLine {
  id: number
  version: number
  timestamp: string
  tags: Record<string, string>
  points: [lat: number, lon: number][]
}
export interface OsmNode {
  id: number
  version: number
  timestamp: string
  tags: Record<string, string>
  lat: number
  lon: number
}
/** Sorted by lat, lon. */
export interface EntranceRow {
  type: string
  entry: boolean
  exit: boolean
  lat: number
  lon: number
}
/** Sorted by code. */
export interface EquipmentRow {
  code: string
  kind: 'elevator' | 'escalator'
  lat: number
  lon: number
  /** The E&E notes text; null when the row has none (the merge then needs a `levels` override). */
  serving: string | null
}
