/** Input types for scripts/build-stations.ts and scripts/fetch-station-sources.ts. Not shipped. */
import type { LatLon } from '../../src/lib/projection.ts'
import type { DepthSource, GeneratedInfo, Level, LevelId } from '../../src/data/stationSchema.ts'

/** [u, v] meters: u along frame.bearingDeg (clockwise from north) from the anchor, v to its right. */
export type FramePoint = [u: number, v: number]

/** data/stations/<id>.authored.json, hand-edited. */
export interface AuthoredStation {
  stationId: string
  name: string
  /** Free text. Facts not confirmed by a source start with "UNVERIFIED:". Not copied to output. */
  notes: string[]
  frame: { anchor: LatLon; bearingDeg: number }
  /** What fetch-station-sources pulls. */
  fetch: { osmWays: number[]; entrancesGtfsStopId: string; equipmentStationMrn: string }
  levels: Level[]
  platforms: { id: string; level: LevelId; osmWay: number; tracks: { stopId: string; path: FramePoint[] }[] }[]
  slabs: { id: string; level: LevelId; name: string; outline: FramePoint[] }[]
  /** Must cover every Open Data row exactly once; matched by the row's exact lat/lon (tolerance 1e-6 deg). */
  entrances: { id: string; source: [lat: number, lon: number] }[]
  /** Stairs and ramps (no source provides them). Escalators/elevators come from E&E. */
  connectors: AuthoredConnector[]
  /** Per-machine corrections to E&E rows, keyed by equipment code. */
  equipment: EquipmentOverride[]
  fareLines: { id: string; level: LevelId; path: FramePoint[] }[]
}
/** `entrance` is allowed only as the upper end; it resolves to the entrance point at the street level. */
export type AuthoredEnd = { level: LevelId; at: FramePoint } | { entrance: string }
export interface AuthoredConnector {
  id: string
  kind: 'stair' | 'ramp'
  width: number
  lower: AuthoredEnd
  upper: AuthoredEnd
}
export interface EquipmentOverride {
  code: string
  /** Replaces the E&E position (adds 'authored' to sources). */
  at?: FramePoint
  /** Street entrance this machine serves. Without `at`, the machine sits at the entrance point. */
  entrance?: string
  /** Required when the station has two levels of the same kind (e.g. Hudson Yards). */
  levels?: { lower: LevelId; upper: LevelId }
  width?: number
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
  }
  entrances: { dataset: 'i9wp-a4ja'; url: string; rowsUpdatedAt: string; rows: EntranceRow[] }
  equipment: { dataset: '94fv-bak7'; url: string; rowsUpdatedAt: string; rows: EquipmentRow[] }
}
export interface OsmWay {
  id: number
  version: number
  timestamp: string
  tags: Record<string, string>
  ring: [lat: number, lon: number][]
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
  serving: string
}
