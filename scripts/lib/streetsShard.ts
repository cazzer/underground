/** The pin's file layout: ways sharded on a fixed lat/lon grid, each shard carrying the node table of its ways
 *  so it reads on its own. A junction on a shard border is in both shards with identical coordinates. */
import type { LatLon } from '../../src/lib/projection.ts'
import type { PinNode, PinWay, TrimmedStreets } from './streetsOsm.ts'

export interface CellDeg {
  lat: number
  lon: number
}

/** About 2.2 km by 2.1 km. Halve it if a shard passes the per-file cap (the shard names then need more decimals). */
export const CELL_DEG: CellDeg = { lat: 0.02, lon: 0.025 }

export interface ShardCell {
  /** floor(lat / cellDeg.lat) and floor(lon / cellDeg.lon). */
  i: number
  j: number
}

export interface StreetShard {
  cell: ShardCell
  /** [id, lat, lon] sorted by id; every node any way of the shard uses. */
  nodes: [number, number, number][]
  /** Sorted by id; each way is in the shard of its first vertex. */
  ways: PinWay[]
}

export function shardCell(p: LatLon, cellDeg: CellDeg = CELL_DEG): ShardCell {
  return { i: Math.floor(p.lat / cellDeg.lat), j: Math.floor(p.lon / cellDeg.lon) }
}

/** `cell-40.70_-73.975.json`: the south-west corner of the cell. */
export function shardFileName(cell: ShardCell, cellDeg: CellDeg = CELL_DEG): string {
  return `cell-${(cell.i * cellDeg.lat).toFixed(2)}_${(cell.j * cellDeg.lon).toFixed(3)}.json`
}

/** Every way into exactly one shard (by its first vertex), shards sorted by file name. */
export function shardStreets(streets: TrimmedStreets, cellDeg: CellDeg = CELL_DEG): StreetShard[] {
  const byName = new Map<string, StreetShard>()
  for (const way of streets.ways) {
    const first = streets.nodes.get(way.nodes[0]!)
    if (first === undefined) throw new Error(`way ${way.id}: first node ${way.nodes[0]} is not in the node table`)
    const cell = shardCell({ lat: first[0], lon: first[1] }, cellDeg)
    const name = shardFileName(cell, cellDeg)
    let shard = byName.get(name)
    if (shard === undefined) {
      shard = { cell, nodes: [], ways: [] }
      byName.set(name, shard)
    } else if (shard.cell.i !== cell.i || shard.cell.j !== cell.j) {
      throw new Error(`${name}: two cells share one file name; the shard names need more decimals for this cell size`)
    }
    shard.ways.push(way)
  }
  for (const shard of byName.values()) {
    const ids = [...new Set(shard.ways.flatMap((w) => w.nodes))].sort((a, b) => a - b)
    shard.nodes = ids.map((id): [number, number, number] => {
      const n: PinNode = streets.nodes.get(id)!
      return [id, n[0], n[1]]
    })
  }
  return [...byName.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, shard]) => shard)
}

export interface ManifestShard {
  file: string
  ways: number
  nodes: number
}

export interface StreetsManifest {
  license: 'ODbL-1.0'
  attribution: string
  fetchedAt: string
  baseTimestamp: string
  overpassUrl: string
  /** Requests made: 1, or the station batches the single request fell back to. */
  requests: number
  radiusM: number
  walk: boolean
  cellDeg: CellDeg
  roadClasses: readonly string[]
  walkClasses: readonly string[]
  query: { head: string; perStation: string; tail: string }
  stations: number
  /** `feedVersion` of the public/data/stations.json the station points came from. */
  stationsFeedVersion: string
  /** The station ids the fetch covered, sorted: what the pin has ways for. A station added since is not in it. */
  stationIds: string[]
  shards: ManifestShard[]
}
