/** Contract for public/data/walk/<stationId>.json: the walkable graph around one station. Built by
 *  scripts/build-walk.ts (2q7.10) from the pinned OSM street extract; read by the walk router (2q7.11). Change both
 *  sides together. Type-only imports with .ts paths so Node can run the scripts that load this file.
 *
 *  Rules the builder keeps, so the client can rely on them:
 *  - The anchor is the station's stations.json point, the same origin as the street file's. A node's x/z here equal
 *    the street file's x/z for the same OSM node id at the same station (the same projection, rounded the same way),
 *    so an entrance joined in the street file (by 1.5 m of ground position plus type) can be snapped to a node here.
 *  - Walkable ways are the pin's named roads and walking ways (`ROAD_CLASSES`, `WALK_CLASSES`) minus `foot=no|private|
 *    use_sidepath` and `access=no|private` without a `foot=yes|designated|permissive`. The graph is undirected: the
 *    vehicle `oneway` is ignored (`oneway:foot` is not pinned). Roads are walkable, kind `road`; the router prices them.
 *  - The file is complete within `radiusM` of the anchor and partial beyond: a way is kept through the first vertex past
 *    the circle, and one that leaves and re-enters is one span, as in the street files. A closed way is whole or absent.
 *  - Every `nodeId` is a real OSM node id, strictly ascending (delta-coded), and only nodes some edge uses are listed.
 *    x/z are integer decimeters (x east, z south). The client decoder owns turning them into meters.
 *  - An edge is a run of one way between two graph nodes: its first and last entries are graph nodes (way ends, or
 *    nodes used by two or more edges), and its interior entries are used by no other edge and once in their own. A ring
 *    with no junction is one edge with first === last. Edges are sorted by way id, then along the way.
 *  - `edgeLength` is round(sum of hypot) over the edge's decimeter points, so it is at least the straight line between
 *    its ends. `steps` is the step-free flag: a router that avoids stairs avoids kind `steps`.
 *  - Ways that cross without a shared node (a bridge over a road, a tunnel) have no junction there. Nothing marks
 *    levels. */
import type { LatLon } from '../lib/projection.ts'
import type { StationId } from './schema.ts'

/** Edge kinds, indexed by `edgeKind`. Append only; a reorder is a format bump. */
export const WALK_KINDS = ['sidewalk', 'crossing', 'footway', 'steps', 'path', 'pedestrian', 'road'] as const
export type WalkKind = (typeof WALK_KINDS)[number]

export interface StationWalk {
  stationId: StationId
  /** The stations.json point, the local origin (same as the street file's). */
  anchor: LatLon
  format: 1
  license: 'ODbL-1.0'
  /** `['© OpenStreetMap contributors']`. */
  attribution: string[]
  /** The pin's OSM base timestamp. */
  osmTimestamp: string
  /** Complete within this many meters of the anchor. */
  radiusM: number
  /** OSM node ids ascending, `deltaEncode`d. */
  nodeId: number[]
  /** Integer decimeters east of the anchor, per node. */
  x: number[]
  /** Integer decimeters south of the anchor, per node. */
  z: number[]
  /** OSM way id per edge, `deltaEncode`d (non-decreasing: a way's edges are adjacent). */
  edgeWay: number[]
  /** Index into WALK_KINDS, per edge. */
  edgeKind: number[]
  /** Integer decimeters along the stored polyline, per edge. */
  edgeLength: number[]
  /** Node indexes along the edge, at least 2 entries. */
  edgeNodes: number[][]
}
