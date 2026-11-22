/** Reads the street pin (data/streets/: a manifest and sharded cell-*.json) into one node table and way list, and
 *  finds the ways near a station. Pure: build-streets.ts and the tests read the files and pass the parsed JSON. */
import type { LatLon } from '../../src/lib/projection.ts'
import type { PinNode, PinWay } from './streetsOsm.ts'
import type { StreetShard, StreetsManifest } from './streetsShard.ts'

/** A pinned way and the lat/lon box of its vertices. */
export interface PinnedWay {
  way: PinWay
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
}

export interface Pin {
  baseTimestamp: string
  /** Every node any way uses. */
  nodes: ReadonlyMap<number, PinNode>
  /** Sorted by way id. */
  ways: readonly PinnedWay[]
}

const METERS_PER_DEG_LAT = 111_195
/** The box test only has to never drop a way the exact clip would keep: grow the radius by this much. */
const BOX_PAD = 1.1
const RAD = Math.PI / 180

/** Merges the manifest's shards. Throws on a shard missing from `shards`, a way id in two shards, a node with two
 *  coordinates, an id that is not a safe integer, or a way node missing from its shard's table. */
export function loadPin(manifest: StreetsManifest, shards: ReadonlyMap<string, StreetShard>): Pin {
  const nodes = new Map<number, PinNode>()
  const wayIds = new Set<number>()
  const ways: PinnedWay[] = []
  for (const entry of manifest.shards) {
    const shard = shards.get(entry.file)
    if (shard === undefined) throw new Error(`${entry.file}: listed in the manifest but not given`)
    const local = new Map<number, PinNode>()
    for (const [id, lat, lon] of shard.nodes) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`${entry.file}: node id ${String(id)} is not a positive safe integer`)
      const prev = nodes.get(id)
      if (prev !== undefined && (prev[0] !== lat || prev[1] !== lon)) {
        throw new Error(`${entry.file}: node ${id} is at ${lat},${lon} here but ${prev.join(',')} in another shard`)
      }
      nodes.set(id, [lat, lon])
      local.set(id, [lat, lon])
    }
    for (const way of shard.ways) {
      if (wayIds.has(way.id)) throw new Error(`${entry.file}: way ${way.id} is in two shards`)
      wayIds.add(way.id)
      let [minLat, maxLat, minLon, maxLon] = [Infinity, -Infinity, Infinity, -Infinity]
      for (const nid of way.nodes) {
        const n = local.get(nid)
        if (n === undefined) throw new Error(`${entry.file}: way ${way.id}: node ${nid} is not in the shard's node table`)
        minLat = Math.min(minLat, n[0])
        maxLat = Math.max(maxLat, n[0])
        minLon = Math.min(minLon, n[1])
        maxLon = Math.max(maxLon, n[1])
      }
      ways.push({ way, minLat, maxLat, minLon, maxLon })
    }
  }
  ways.sort((a, b) => a.way.id - b.way.id)
  return { baseTimestamp: manifest.baseTimestamp, nodes, ways }
}

/** The ways whose box comes within `radiusM` of the anchor (a superset of those with a segment within it), in id order. */
export function waysNear(pin: Pin, anchor: LatLon, radiusM: number): PinnedWay[] {
  const dLat = (radiusM * BOX_PAD) / METERS_PER_DEG_LAT
  const dLon = dLat / Math.cos(anchor.lat * RAD)
  return pin.ways.filter(
    (w) => w.maxLat >= anchor.lat - dLat && w.minLat <= anchor.lat + dLat && w.maxLon >= anchor.lon - dLon && w.minLon <= anchor.lon + dLon,
  )
}
