/**
 * Web worker: fetches basemap tiles (same origin, one AbortController each), inflates a gzipped body (inflate.ts)
 * and decodes them into per-class segment buffers (decodeTile.ts), so no tile is ever decoded on the main thread.
 * The roads are cut under the route lines by a clip built once from the init message's tracks (routeClip.ts); a
 * build that throws fails the worker, so the store turns the basemap off (logged). basemapTiles.ts drives it.
 */
import { decodeTile, isMvtBytes } from '../lib/basemap/decodeTile'
import { inflateIfGzip } from '../lib/basemap/inflate'
import { buildRouteClip, type RouteClip } from '../lib/routeClip'
import { unpackTracks } from '../lib/routeTracks'
import type { BasemapReply, BasemapRequest } from './basemapProtocol'

/** The worker global, typed for the two members this uses (the project's lib is DOM, not WebWorker). */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BasemapRequest>) => void) | null
  postMessage(message: BasemapReply, transfer?: Transferable[]): void
}

let layers: string[] = []
let clip: RouteClip | null = null
const inflight = new Map<number, AbortController>()

type Load = Extract<BasemapRequest, { type: 'load' }>

async function load({ key, seq, url, z, x, y }: Load, controller: AbortController): Promise<BasemapReply | null> {
  let body: Uint8Array
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (res.status === 404) return { type: 'empty', key, seq, reason: 'missing', detail: 'HTTP 404' }
    if (!res.ok) return { type: 'error', key, seq, message: `HTTP ${res.status}` }
    body = new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    if (controller.signal.aborted) return null
    return { type: 'error', key, seq, message: err instanceof Error ? err.message : String(err) }
  }
  if (controller.signal.aborted) return null
  try {
    body = await inflateIfGzip(body)
  } catch (err) {
    return { type: 'empty', key, seq, reason: 'not-mvt', detail: `bad gzip: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (controller.signal.aborted) return null
  if (!isMvtBytes(body)) {
    const head = [...body.subarray(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    return { type: 'empty', key, seq, reason: 'not-mvt', detail: `starts with ${head}` }
  }
  const t0 = performance.now()
  try {
    const classes = decodeTile(body, z, x, y, layers, clip)
    return { type: 'tile', key, seq, classes, decodeMs: performance.now() - t0, bodyBytes: body.byteLength }
  } catch (err) {
    return { type: 'empty', key, seq, reason: 'not-mvt', detail: err instanceof Error ? err.message : String(err) }
  }
}

scope.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    layers = msg.layers
    try {
      clip = buildRouteClip(unpackTracks(msg.tracks))
    } catch (err) {
      throw new Error(`basemap route clip: ${err instanceof Error ? err.message : String(err)}`)
    }
    return
  }
  if (msg.type === 'cancel') {
    inflight.get(msg.key)?.abort()
    inflight.delete(msg.key)
    return
  }
  inflight.get(msg.key)?.abort()
  const controller = new AbortController()
  inflight.set(msg.key, controller)
  void load(msg, controller).then((reply) => {
    if (inflight.get(msg.key) === controller) inflight.delete(msg.key)
    if (reply === null) return
    const transfer = reply.type === 'tile' ? Object.values(reply.classes).map((b) => b.buffer as ArrayBuffer) : []
    scope.postMessage(reply, transfer)
  })
}
