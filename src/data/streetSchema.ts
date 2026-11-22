/** Contract for public/data/streets/<stationId>.json: the street network around one station and where each
 *  of its entrances opens onto it. Built by scripts (ost.3) from the pinned OSM extract; read by the client (ost.4).
 *  Change both sides together. Type-only imports with .ts paths so Node can run the scripts that load this file.
 *
 *  Rules the builder (ost.3) keeps, so the client can rely on them:
 *  - The anchor is the station's stations.json point; the file is keyed by station id only. The interior anchor
 *    differs (L08's is about (-11.80, -10.90) m from it), so entrances are matched to an interior's by scene ground position.
 *  - Every `nodeId` is a real OSM node id. Ways index into the node table, so a junction is stored once.
 *  - Clipping to the radius keeps whole vertices: a way is cut at the first vertex past the radius, never inside a segment.
 *    A way that leaves and re-enters the radius is kept as one span, from the last vertex before its first entry to
 *    the first vertex after its last exit, one entry per id. A closed way is kept whole or dropped, never opened by
 *    clipping, so `isClosedRing(nodes)` stays true exactly for the OSM-closed ways.
 *  - Simplification (dropping collinear vertices) never drops a node used by two or more ways or any way's end node.
 *  - Coordinates are integer decimeters. The entrance join runs on these same decimeter coordinates (as meters),
 *    so what the file says and what the join saw are one thing.
 *  - Ways are sorted by id, entrances by x then z.
 *
 *  The client decoder (ost.4) owns turning the packed node table into meters.
 *
 *  Entrances carry no id. To find the street join of an interior's entrance (ost.4, ost.5), compare scene ground
 *  positions: the interior entrance's (`toGround(interior.anchor)` plus its x/z) and the file's (`toGround(anchor)`
 *  plus x/z in meters). They match when within 1.5 m and the `type` is equal. */
import type { LatLon } from '../lib/projection.ts'
import type { StationId, StopId } from './schema.ts'

/** The side of the street an entrance is on, in compass words (x east, z south). A corner entrance gets the
 *  corner of the two streets (`NE`); `median` is an entrance between two carriageways of one street. */
export type StreetSide = 'north' | 'south' | 'east' | 'west' | 'NE' | 'SE' | 'SW' | 'NW' | 'median'

/** One OSM way near the station. Roadways, footways (sidewalk, crossing), steps, pedestrian and path, named or not.
 *  Which ones are streets is `isStreet` in src/lib/streetClass.ts, not a flag here. */
export interface StreetWay {
  /** OSM way id. */
  id: number
  /** The raw OSM `highway=` value. */
  highway: string
  /** The raw OSM `footway=` value (sidewalk, crossing, ...); omitted when the way has none. */
  footway?: string
  /** The OSM `name`, verbatim; null when unnamed. */
  name: string | null
  /** The vehicle one-way tag, normalized from OSM `oneway`: 1 travel runs along the node order, -1 against it, 0 both
   *  ways or not a one-way. A walk graph must ignore it (pedestrians walk both ways) unless `oneway:foot` says
   *  otherwise; that tag is not stored. */
  oneway: 0 | 1 | -1
  /** Indexes into the file's node table, in way order. A closed way repeats its first index at the end. */
  nodes: number[]
}

/** The result of joining an entrance to its street: what `joinEntrance` returns. */
export interface StreetJoin {
  /** The nearest street's OSM name, verbatim; null when none is in range. */
  street: string | null
  /** That street's nearest way (the carriageway the entrance is nearest to). */
  wayId: number | null
  /** The second street at a corner; null when the entrance is mid-block. */
  cross: string | null
  crossWayId: number | null
  /** Null when no street is in range or the entrance sits on the street's centerline (within 1 m). */
  side: StreetSide | null
  /** The name of the pedestrian plaza the entrance is inside, if any. */
  plaza: string | null
}

export interface StreetEntrance extends StreetJoin {
  /** Integer decimeters from the anchor, x east, z south. */
  x: number
  z: number
  /** The raw NY Open Data entrance type, as in the interior's entrances. */
  type: string
  entry: boolean
  exit: boolean
  stopIds: StopId[]
}

export interface StationStreets {
  stationId: StationId
  /** The station's stations.json point: the local origin. */
  anchor: LatLon
  format: 1
  /** The whole file is a derivative database of OpenStreetMap; entrances are MTA data (see attribution). */
  license: 'ODbL-1.0'
  /** Credits required by the sources present: OSM first, then the OPEN-NY note. */
  attribution: string[]
  /** The pin's OSM timestamp (ISO 8601). */
  osmTimestamp: string
  /** How far from the anchor named roadways (`highway` trunk to pedestrian with a `name`) are kept, meters. */
  radiusM: number
  /** How far from the anchor everything else is kept (footway, steps, path and unnamed ways), meters; at most
   *  `radiusM`. Past it a way is cut or absent, so a walk graph over these ways is complete only inside it. */
  walkRadiusM: number
  /** The node table: OSM node ids, ascending, delta-coded (`deltaEncode` in src/data/codec.ts). Ids stay below 2^53. */
  nodeId: number[]
  /** Parallel to `nodeId`: integer decimeters from the anchor (x east, z south). */
  x: number[]
  z: number[]
  /** Sorted by id. */
  ways: StreetWay[]
  /** Sorted by x, then z. */
  entrances: StreetEntrance[]
}
