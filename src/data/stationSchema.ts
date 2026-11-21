/** Contract for public/data/stations/<stationId>.json, written by scripts/build-stations.ts
 *  from data/stations/<id>.authored.json + <id>.sources.json. Change both sides together.
 *  Type-only imports with .ts paths so Node can run the scripts that load this file. */
import type { LatLon } from '../lib/projection.ts'
import type { StationId, StopId } from './schema.ts'

/** Station-local meters from `anchor`, scene axes: [x east, z south]. Rounded to 0.01. */
export type LocalPoint = [x: number, z: number]
export type LevelId = string
export type InteriorSource = 'osm' | 'nyopendata' | 'authored' | 'generated'
/** Whether a station's interior is hand-built or generated from an archetype template. */
export type InteriorProvenance = 'authored' | 'generated'
export type Archetype =
  | 'elevated-2-track'
  | 'elevated-3-track'
  | 'shallow-per-direction'
  | 'cut-cover-mezzanine'
  | 'underground-express'
  | 'deep'
  | 'open-air'
  | 'unknown'
export type DepthSource = 'ee-rise' | 'deep-list' | 'osm-level' | 'structure-default'
export type LevelKind = 'street' | 'mezzanine' | 'platform'
export type ConnectorKind = 'stair' | 'escalator' | 'elevator' | 'ramp'

export interface GeneratedInfo {
  archetype: Exclude<Archetype, 'unknown'>
  /** 0..1, at or above the pipeline's interior bar. */
  confidence: number
}

export interface StationInterior {
  stationId: StationId
  name: string
  /** Local origin. Render in a group at toGround(anchor); children use local x/z as-is. */
  anchor: LatLon
  /** The whole file is a derivative database of OpenStreetMap. OSM-derived parts are ODbL 1.0; `nyopendata` elements are MTA data under the OPEN-NY Terms of Use (see attribution). */
  license: 'ODbL-1.0'
  /** Credits required by the sources present, fixed order (OSM first). */
  attribution: string[]
  /** Present only on generated interiors; absent = hand-authored. */
  generated?: GeneratedInfo
  /** Sorted by y, highest first. Exactly one 'street' level, at y = 0. */
  levels: Level[]
  platforms: Platform[] // all arrays below sorted by id
  slabs: Slab[]
  connectors: Connector[]
  entrances: Entrance[]
  fareLines: FareLine[] // may be empty
}

export interface Level {
  id: LevelId
  name: string
  kind: LevelKind
  /** Walking-surface elevation, meters relative to the street (0); negative is below. */
  y: number
  /** Generated, non-street levels only. 'ee-rise' is measured; anything else is an estimate (label "≈"). */
  depthSource?: DepthSource
}

/** Outlines are open rings (no repeated closing point), >= 3 points, any winding. */
export interface Platform {
  id: string
  level: LevelId
  outline: LocalPoint[]
  /** One per platform edge served: island = 2, side platform = 1. */
  tracks: Track[]
  /** e.g. "way/906963980". */
  osmRef: string
  sources: InteriorSource[]
}
export interface Track {
  /** Child stop served from this edge, e.g. "L08N". */
  stopId: StopId
  /** Track centerline at the platform level's y (the renderer may drop it to rail height). */
  path: LocalPoint[]
}
/** Walkable floor that isn't a platform: mezzanines, passages. */
export interface Slab {
  id: string
  level: LevelId
  name: string
  outline: LocalPoint[]
  sources: InteriorSource[]
}

export interface Endpoint {
  x: number
  z: number
  level: LevelId
}
export interface Connector {
  /** Elevators/escalators use the MTA equipment code ("EL358"), the join key for live outages. */
  id: string
  kind: ConnectorKind
  /**
   * y(lower.level) < y(upper.level). Elevators, and escalators from the E&E inventory, have identical x/z
   * at both ends (the renderer gives such an escalator a 30 degree run).
   */
  lower: Endpoint
  upper: Endpoint
  /** Meters across the direction of travel; elevators: shaft side length. */
  width: number
  /** Escalators only, when the serving text names one direction of travel; omitted for "both directions". */
  travel?: 'up' | 'down'
  sources: InteriorSource[]
}
/** Street-level point (y = 0). */
export interface Entrance {
  id: string
  x: number
  z: number
  /** Raw NY Open Data entrance_type: "Stair", "Elevator", "Stair/Escalator", ... */
  type: string
  entry: boolean
  exit: boolean
  /**
   * Connectors whose end on the street is at this entrance (an escalator moved by an authored `at` may sit
   * off it); at least one, sorted. A connector is listed by at most one entrance.
   */
  connectors: string[]
  sources: InteriorSource[]
}
export interface FareLine {
  id: string
  level: LevelId
  path: LocalPoint[]
  sources: InteriorSource[]
}

/** public/data/stations/index.json: every station that has an interior file. Fetched after the startup files (not render-blocking), so it has its own size cap rather than the startup budget. */
export interface StationIndexEntry {
  provenance: InteriorProvenance
}
export interface StationIndex {
  /** Written in id order, except that JS lists integer-like ids first; don't rely on key order. */
  stations: Record<StationId, StationIndexEntry>
}

/** One platform track's own values (an override in `PackedDepthsFile.tracks`): rail y in decimeters, centre x and z in
 *  whole meters east and south of the station's stations.json point, and half-length in whole meters. */
export type PackedTrack = [y: number, x: number, z: number, h: number]

/**
 * public/data/station-depths.json, written by scripts/build-stations.ts from every interior (authored and generated):
 * per station the rail height and where its platform tracks run along the drawn track lines, so the map's tracks can
 * descend to meet the interior. Columnar to fit the startup budget; src/data/depthsCodec.ts decodes it to a
 * `StationDepthsFile` against the same build's stations.json and drawn lines. ODbL like the interiors.
 *
 * Column values (whole meters unless noted) are measured along the drawn line of the stop's direction nearest the
 * station's stations.json point P, from P's projection d onto it: the N track runs d + a ± h, the S track d - a + da ±
 * (h + dh). So da and dh are 0 when the S track mirrors the N one, the common case.
 */
export interface PackedDepthsFile {
  license: 'ODbL-1.0'
  /** Union of the interiors' credits, OSM first. */
  attribution: string[]
  format: 2
  /** stations.json's feedVersion when packed: the indexes below only mean anything against that build. */
  feedVersion: string
  /** One entry per station, in stations.json order: its index there, minus the previous entry's (the first is its index). */
  station: number[]
  /** Columns parallel to `station`. Rail y, decimeters relative to the street (negative below). */
  y: number[]
  /** N track centre along its line from d. */
  a: number[]
  /** N track half-length. */
  h: number[]
  /** S track: centre is d - a + da along its line, half-length h + dh. */
  da: number[]
  dh: number[]
  /** A child stop the columns don't reproduce: its own values (centre-based), or null when it has no track. */
  tracks: Record<StopId, PackedTrack | null>
}

/**
 * The per-track station depths the track profile is anchored to (trackAnchors.ts `profileRuns`): each platform
 * track's ends and rail height. Decoded from public/data/station-depths.json (`PackedDepthsFile`); the build also
 * makes it directly from the interiors (scripts/lib/stationDepths.ts) before packing.
 */
export interface StationDepthsFile {
  license: 'ODbL-1.0'
  /** Union of the interiors' credits, OSM first. */
  attribution: string[]
  /** Sorted by stationId. */
  stations: StationDepth[]
}
export interface StationDepth {
  stationId: StationId
  anchor: LatLon
  /** Sorted by stopId. */
  tracks: TrackDepth[]
}
export interface TrackDepth {
  stopId: StopId
  /** Real rail height, meters relative to the street (platform level y - RAIL_DROP_M), rounded to 0.01 (0.1 decoded). */
  railY: number
  /** First and last point of the interior's track path, station-local meters (decoded: on the nearest drawn track line). */
  ends: [LocalPoint, LocalPoint]
}
