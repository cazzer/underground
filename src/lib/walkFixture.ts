/** Synthetic walk graphs for the router and exit-choice tests. */
import { decodeStationWalk } from '../data/loadStationWalk'
import { WALK_KINDS, type StationWalk, type WalkGraph, type WalkKind } from '../data/walkSchema'
import type { LatLon } from './projection'

export interface WalkEdgeSpec {
  kind?: WalkKind
  /** Node indexes into `nodes`, at least 2; first === last makes a ring. */
  nodes: number[]
}

/** The anchor the interior fixture shares, so a test can place a walk and an interior on one point. */
export const FIXTURE_ANCHOR: LatLon = { lat: 40.7, lon: -73.9 }

/** The file form of a graph: nodes in meters (rounded to decimeters), edges as given. */
export function walkFile(nodes: [number, number][], edges: WalkEdgeSpec[], radiusM = 300, anchor: LatLon = FIXTURE_ANCHOR): StationWalk {
  const x = nodes.map(([px]) => Math.round(px * 10))
  const z = nodes.map(([, pz]) => Math.round(pz * 10))
  const edgeLength = edges.map((e) => {
    let len = 0
    for (let i = 1; i < e.nodes.length; i++) len += Math.hypot(x[e.nodes[i]!]! - x[e.nodes[i - 1]!]!, z[e.nodes[i]!]! - z[e.nodes[i - 1]!]!)
    return Math.round(len)
  })
  return {
    stationId: 'X01',
    anchor,
    format: 1,
    license: 'ODbL-1.0',
    attribution: ['© OpenStreetMap contributors'],
    osmTimestamp: '2026-11-01T00:00:00Z',
    radiusM,
    nodeId: nodes.map(() => 1),
    x,
    z,
    edgeWay: edges.map((_, i) => (i === 0 ? 1 : 0)),
    edgeKind: edges.map((e) => WALK_KINDS.indexOf(e.kind ?? 'sidewalk')),
    edgeLength,
    edgeNodes: edges.map((e) => e.nodes),
  }
}

export function walkGraph(nodes: [number, number][], edges: WalkEdgeSpec[], radiusM = 300): WalkGraph {
  return decodeStationWalk(walkFile(nodes, edges, radiusM))
}

/** A square grid of `side` x `side` nodes `step` m apart, joined by sidewalks; node (i, j) is j * side + i. */
export function gridGraph(side: number, step: number): WalkGraph {
  const nodes: [number, number][] = []
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) nodes.push([i * step, j * step])
  const edges: WalkEdgeSpec[] = []
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      if (i + 1 < side) edges.push({ nodes: [j * side + i, j * side + i + 1] })
      if (j + 1 < side) edges.push({ nodes: [j * side + i, (j + 1) * side + i] })
    }
  }
  return walkGraph(nodes, edges)
}
