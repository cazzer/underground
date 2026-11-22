/**
 * Web worker: fetches basemap tiles (same origin, one AbortController each) and decodes them into per-class
 * segment buffers (decodeTile.ts), so no tile is ever decoded on the main thread. basemapTiles.ts drives it.
 */
import { decodeTile, isMvtBytes } from '../lib/basemap/decodeTile'
import type { BasemapReply, BasemapRequest } from './basemapProtocol'

/** The worker global, typed for the two members this uses (the project's lib is DOM, not WebWorker). */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BasemapRequest>) => void) | null
  postMessage(message: BasemapReply, transfer?: Transferable[]): void
}

let layers: string[] = []
const inflight = new Map<number, AbortController>()

async function load(key: number, url: string, z: number, x: number, y: number, controller: AbortController): Promise<BasemapReply | null> {
  let body: Uint8Array
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (res.status === 404) return { type: 'empty', key, reason: 'missing', detail: 'HTTP 404' }
    if (!res.ok) return { type: 'error', key, message: `HTTP ${res.status}` }
    body = new Uint8Array(await res.arrayBuffer())
  } catch (err) {
    if (controller.signal.aborted) return null
    return { type: 'error', key, message: err instanceof Error ? err.message : String(err) }
  }
  if (controller.signal.aborted) return null
  if (!isMvtBytes(body)) {
    const head = [...body.subarray(0, 2)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
    return { type: 'empty', key, reason: 'not-mvt', detail: `starts with ${head}` }
  }
  const t0 = performance.now()
  try {
    const classes = decodeTile(body, z, x, y, layers)
    return { type: 'tile', key, classes, decodeMs: performance.now() - t0, bodyBytes: body.byteLength }
  } catch (err) {
    return { type: 'empty', key, reason: 'not-mvt', detail: err instanceof Error ? err.message : String(err) }
  }
}

scope.onmessage = (e) => {
  const msg = e.data
  if (msg.type === 'init') {
    layers = msg.layers
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
  void load(msg.key, msg.url, msg.z, msg.x, msg.y, controller).then((reply) => {
    if (inflight.get(msg.key) === controller) inflight.delete(msg.key)
    if (reply === null) return
    const transfer = reply.type === 'tile' ? Object.values(reply.classes).map((b) => b.buffer as ArrayBuffer) : []
    scope.postMessage(reply, transfer)
  })
}
