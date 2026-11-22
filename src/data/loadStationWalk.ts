/**
 * Loads and decodes a station's walk shard (`public/data/walk/<id>.json`, `StationWalk`) into a `WalkGraph`.
 *
 * Privacy: requesting a shard reveals its station id to the static host (GitHub Pages). So a shard is fetched only for
 * a station the user picked, focused, or chose as a trip endpoint. A caller never derives the id from a location fix
 * (`nearestStation` in locate.ts) without a user action, and no request carries the fix or a destination: the URL
 * names a station and nothing else. Routing runs on the device.
 */
import { toGround } from '../lib/projection'
import { deltaDecode } from './codec'
import { fetchJson, HttpError } from './loadNetwork'
import { WALK_KINDS, type StationWalk, type WalkGraph } from './walkSchema'

/** The decoded edge length may differ from the file's decimeter-rounded one by up to this much (0.05 m, with slack). */
const LENGTH_TOLERANCE_M = 0.06

/**
 * Checks the outer shape of a fetched walk file: its station and anchor, format 1, a positive radius, and the node
 * and edge columns with equal lengths. Entries are checked by `decodeStationWalk`.
 */
export function expectStationWalk(raw: unknown, id: string, url: string): StationWalk {
  const fail = () => new Error(`${url}: not a walk file for ${id}`)
  if (typeof raw !== 'object' || raw === null) throw fail()
  const r = raw as Record<string, unknown>
  const anchor = r.anchor as Record<string, unknown> | null | undefined
  const { nodeId, x, z, edgeWay, edgeKind, edgeLength, edgeNodes, radiusM } = r
  if (
    r.stationId !== id ||
    typeof anchor !== 'object' ||
    anchor === null ||
    !Number.isFinite(anchor.lat) ||
    !Number.isFinite(anchor.lon) ||
    r.format !== 1 ||
    typeof radiusM !== 'number' ||
    !(radiusM > 0) ||
    !Array.isArray(nodeId) ||
    !Array.isArray(x) ||
    !Array.isArray(z) ||
    x.length !== nodeId.length ||
    z.length !== nodeId.length ||
    !Array.isArray(edgeWay) ||
    !Array.isArray(edgeKind) ||
    !Array.isArray(edgeLength) ||
    !Array.isArray(edgeNodes) ||
    edgeKind.length !== edgeWay.length ||
    edgeLength.length !== edgeWay.length ||
    edgeNodes.length !== edgeWay.length
  ) {
    throw fail()
  }
  return raw as StationWalk
}

/**
 * Turns a checked walk file into a `WalkGraph`: ids delta-decoded, x/z in meters, every edge's length recomputed from
 * its points. Throws, naming the station and edge, on a kind outside `WALK_KINDS`, an edge of under two nodes or a
 * node index out of range, or a length more than 0.06 m from the file's.
 */
export function decodeStationWalk(file: StationWalk): WalkGraph {
  const id = file.stationId
  const nodeCount = file.nodeId.length
  const x = Float64Array.from(file.x, (v) => v / 10)
  const z = Float64Array.from(file.z, (v) => v / 10)
  const edgeCount = file.edgeWay.length
  const edgeKind = new Uint8Array(edgeCount)
  const edgeLength = new Float64Array(edgeCount)
  const edgeNodes: Int32Array[] = []
  const degree = new Int32Array(nodeCount + 1)
  for (let e = 0; e < edgeCount; e++) {
    const kind = file.edgeKind[e]!
    if (!Number.isInteger(kind) || kind < 0 || kind >= WALK_KINDS.length) {
      throw new Error(`Walk file for ${id}: edge ${e} has kind ${kind}`)
    }
    const nodes = file.edgeNodes[e]!
    if (!Array.isArray(nodes) || nodes.length < 2) throw new Error(`Walk file for ${id}: edge ${e} has under two nodes`)
    let length = 0
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      if (!Number.isInteger(n) || n < 0 || n >= nodeCount) throw new Error(`Walk file for ${id}: edge ${e} has node ${n} out of range`)
      if (i > 0) length += Math.hypot(x[n]! - x[nodes[i - 1]!]!, z[n]! - z[nodes[i - 1]!]!)
    }
    const stored = file.edgeLength[e]! / 10
    if (!(Math.abs(length - stored) <= LENGTH_TOLERANCE_M)) {
      throw new Error(`Walk file for ${id}: edge ${e} is ${length.toFixed(2)} m long, the file says ${stored} m`)
    }
    edgeKind[e] = kind
    edgeLength[e] = length
    edgeNodes.push(Int32Array.from(nodes))
    const first = nodes[0]!
    const last = nodes[nodes.length - 1]!
    if (first !== last) {
      degree[first + 1]!++
      degree[last + 1]!++
    }
  }
  const adjStart = degree
  for (let n = 0; n < nodeCount; n++) adjStart[n + 1]! += adjStart[n]!
  const adjEdge = new Int32Array(adjStart[nodeCount]!)
  const fill = adjStart.slice(0, nodeCount)
  for (let e = 0; e < edgeCount; e++) {
    const nodes = edgeNodes[e]!
    const first = nodes[0]!
    const last = nodes[nodes.length - 1]!
    if (first === last) continue
    adjEdge[fill[first]!++] = e
    adjEdge[fill[last]!++] = e
  }
  return {
    stationId: id,
    anchor: toGround(file.anchor),
    radiusM: file.radiusM,
    nodeId: deltaDecode(file.nodeId),
    x,
    z,
    edgeWay: deltaDecode(file.edgeWay),
    edgeKind,
    edgeLength,
    edgeNodes,
    adjStart,
    adjEdge,
  }
}

/**
 * Fetches `<baseUrl>data/walk/<id>.json` and checks its outer shape. A station with no walk file (404) gives null,
 * with one warning; any other failure rejects. See the file header for who may call this.
 */
export async function loadStationWalk(baseUrl: string, id: string): Promise<StationWalk | null> {
  const url = `${baseUrl}data/walk/${id}.json`
  let raw: unknown
  try {
    raw = await fetchJson(url)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      console.warn(`No walk file for station ${id} (${url})`)
      return null
    }
    throw err
  }
  return expectStationWalk(raw, id, url)
}
