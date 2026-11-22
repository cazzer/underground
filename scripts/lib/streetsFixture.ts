/** A tiny street pin for the street-build tests: ways given in meters around a station, laid onto real lat/lon. */
import type { Station } from '../../src/data/schema.ts'
import { toLatLon } from '../../src/lib/projection.ts'
import type { PinWay } from './streetsOsm.ts'
import { loadPin, type Pin } from './streetsPin.ts'
import type { StreetShard, StreetsManifest } from './streetsShard.ts'

export const STATION: Station = { id: 'T01', name: 'Test St', lat: 40.7, lon: -74, stops: ['T01N', 'T01S'], routes: ['A'], borough: 'M', ada: 'none' }

/** Node id to its [x, z] in meters from STATION (x east, z south). */
export type NodeMeters = Record<number, readonly [number, number]>

export function manifestOf(files: readonly string[]): StreetsManifest {
  return {
    license: 'ODbL-1.0',
    attribution: '© OpenStreetMap contributors',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    baseTimestamp: '2026-01-01T00:00:00Z',
    overpassUrl: 'https://example.test/',
    requests: 1,
    radiusM: 300,
    walk: true,
    cellDeg: { lat: 0.02, lon: 0.025 },
    roadClasses: [],
    walkClasses: [],
    query: { head: '', perStation: '', tail: '' },
    stations: 1,
    stationsFeedVersion: 'test',
    shards: files.map((file) => ({ file, ways: 0, nodes: 0 })),
  }
}

export function shardOf(nodes: NodeMeters, ways: readonly PinWay[], cell = { i: 0, j: 0 }): StreetShard {
  const used = [...new Set(ways.flatMap((w) => w.nodes))].sort((a, b) => a - b)
  return {
    cell,
    nodes: used.map((id): [number, number, number] => {
      const [x, z] = nodes[id]!
      const p = toLatLon({ x, z }, STATION)
      return [id, Math.round(p.lat * 1e6) / 1e6, Math.round(p.lon * 1e6) / 1e6]
    }),
    ways: [...ways].sort((a, b) => a.id - b.id),
  }
}

export function way(id: number, tags: Record<string, string>, nodes: number[]): PinWay {
  return { id, tags, nodes }
}

export function pinOf(nodes: NodeMeters, ways: readonly PinWay[]): Pin {
  return loadPin(manifestOf(['a.json']), new Map([['a.json', shardOf(nodes, ways)]]))
}
