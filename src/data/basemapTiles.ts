/**
 * The basemap tile store (no React): picks the tiles the view needs, loads them through the basemap worker (at
 * most MAX_IN_FLIGHT at a time, nearest the view center first, unwanted ones cancelled), keeps decoded tiles in
 * an LRU and says what to draw meanwhile (tileCover.ts). Nothing loads until `start`; a missing or crashed worker
 * turns the basemap off (logged once), with no main-thread fallback. Under the location cap (locationCap.ts) no
 * tile finer than the cap is ever asked for.
 */
import { Vector3, type PerspectiveCamera } from 'three'
import { footprintInside, groundFootprint, MARGIN, selectTiles, type WantedTile } from '../lib/basemap/footprint'
import { markSelected, newReselect, reselectDue, type ViewPose } from '../lib/basemap/reselect'
import { drawnTiles } from '../lib/basemap/tileCover'
import { createTileLru } from '../lib/basemap/tileLru'
import { keyX, keyY, keyZ, MIN_Z, zoomFor } from '../lib/basemap/tileMath'
import { tileUrl, type BasemapConfig } from './basemapConfig'
import type { BasemapReply, BasemapRequest } from './basemapProtocol'
import type { BasemapTile, BasemapTiles, BasemapWorkerLike } from './basemapTypes'

export const MAX_IN_FLIGHT = 6
/** A tile that failed to load (network, 5xx) is asked for again after this long, if still wanted. */
export const RETRY_MS = 15_000
/** The request log `stats()` keeps for the dev hook. */
const LOG_MAX = 200

export interface BasemapTilesOptions {
  /** The worker to drive; null when there is none (the basemap is then off). Tests pass a fake. */
  createWorker?: () => BasemapWorkerLike | null
}

function realWorker(): BasemapWorkerLike | null {
  if (typeof Worker === 'undefined') return null
  return new Worker(new URL('./basemapWorker.ts', import.meta.url), { type: 'module' }) as unknown as BasemapWorkerLike
}

/** The four frustum corners in NDC, in the order groundFootprint expects. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1]

export function createBasemapTiles(config: BasemapConfig, { createWorker = realWorker }: BasemapTilesOptions = {}): BasemapTiles {
  let worker: BasemapWorkerLike | null = null
  let disabled = false
  let capZ: number | null = null
  let reselect = newReselect()
  /** The last `update` time: replies are timed by it. */
  let clock = 0
  let z = MIN_Z
  let wanted: WantedTile[] = []
  let wantedKeys = new Set<number>()
  const lru = createTileLru<BasemapTile>()
  const empty = new Set<number>()
  const retryAt = new Map<number, number>()
  /** The soonest retry of a wanted tile, so a frame checks one number. */
  let nextRetryAt = Infinity
  /** Tile key to the sequence number of its outstanding load. */
  const inflight = new Map<number, number>()
  let seq = 0
  let drawnKeys: number[] = []
  let drawnSet = new Set<number>()
  let drawn: BasemapTile[] = []
  let version = 0
  const counts = { requested: 0, loaded: 0, missing: 0, notMvt: 0, errors: 0, cancelled: 0, stale: 0 }
  const decode = { count: 0, total: 0, max: 0 }
  const requestLog: string[] = []
  const logged = new Set<string>()
  const rays = { p: new Float64Array(3), dirs: new Float64Array(12), distance: 0 }
  const footprint = new Float64Array(8)
  /** The footprint of the last choice, and whether there is one. */
  const chosen = new Float64Array(8)
  let hasChosen = false
  const v = new Vector3()

  const logOnce = (reason: string, log: () => void) => {
    if (logged.has(reason)) return
    logged.add(reason)
    log()
  }
  const post = (msg: BasemapRequest) => worker?.postMessage(msg)
  const place = (key: number) => `${keyZ(key)}/${keyX(key)}/${keyY(key)}`
  const allowed = (tz: number) => capZ === null || tz <= capZ

  function recomputeDrawn(): void {
    const keys = drawnTiles([...wantedKeys], (k) => lru.has(k) || empty.has(k), drawnKeys).filter((k) => lru.has(k))
    keys.sort((a, b) => a - b)
    if (keys.length === drawnKeys.length && keys.every((k, i) => k === drawnKeys[i])) return
    drawnKeys = keys
    drawnSet = new Set(keys)
    drawn = keys.map((k) => lru.peek(k)!)
    for (const k of keys) lru.touch(k)
    version++
  }

  function pump(): void {
    if (worker === null) return
    for (const t of wanted) {
      if (inflight.size >= MAX_IN_FLIGHT) return
      if (!allowed(t.z) || inflight.has(t.key) || lru.has(t.key) || empty.has(t.key)) continue
      const at = retryAt.get(t.key) ?? -Infinity
      if (at > clock) {
        nextRetryAt = Math.min(nextRetryAt, at)
        continue
      }
      inflight.set(t.key, ++seq)
      counts.requested++
      requestLog.push(place(t.key))
      if (requestLog.length > LOG_MAX) requestLog.shift()
      post({ type: 'load', key: t.key, seq, url: tileUrl(config, t.z, t.x, t.y), z: t.z, x: t.x, y: t.y })
    }
  }

  function cancelWhere(drop: (key: number) => boolean): void {
    for (const key of [...inflight.keys()]) {
      if (!drop(key)) continue
      inflight.delete(key)
      counts.cancelled++
      post({ type: 'cancel', key })
    }
  }

  function setWanted(tiles: WantedTile[]): void {
    wanted = tiles
    wantedKeys = new Set(tiles.map((t) => t.key))
    cancelWhere((key) => !wantedKeys.has(key))
    recomputeDrawn()
    pump()
  }

  function onReply(reply: BasemapReply): void {
    const { key } = reply
    if (inflight.get(key) !== reply.seq) {
      counts.stale++
      return
    }
    inflight.delete(key)
    if (reply.type === 'tile') {
      const bytes = Object.values(reply.classes).reduce((n, b) => n + b.byteLength, 0)
      lru.set(key, { key, z: keyZ(key), x: keyX(key), y: keyY(key), classes: reply.classes, bytes })
      retryAt.delete(key)
      counts.loaded++
      decode.count++
      decode.total += reply.decodeMs
      decode.max = Math.max(decode.max, reply.decodeMs)
    } else if (reply.type === 'empty') {
      empty.add(key)
      retryAt.delete(key)
      if (reply.reason === 'missing') {
        counts.missing++
        logOnce('missing', () => console.info(`Basemap tile ${place(key)} is not served; areas without tiles draw no basemap`))
      } else {
        counts.notMvt++
        logOnce('not-mvt', () => console.error(`Basemap tile ${place(key)} is not raw MVT (${reply.detail}); such tiles draw nothing`))
      }
    } else {
      counts.errors++
      const at = clock + RETRY_MS
      retryAt.set(key, at)
      nextRetryAt = Math.min(nextRetryAt, at)
      logOnce('error', () => console.error(`Basemap tile ${place(key)} failed to load (${reply.message}); retrying in ${RETRY_MS / 1000} s`))
    }
    recomputeDrawn()
    lru.evict((k) => drawnSet.has(k) || wantedKeys.has(k))
    pump()
  }

  function stop(): void {
    worker?.terminate()
    worker = null
    reselect = newReselect()
    hasChosen = false
    wanted = []
    wantedKeys = new Set()
    inflight.clear()
    retryAt.clear()
    nextRetryAt = Infinity
    lru.clear()
    drawnKeys = []
    drawnSet = new Set()
    drawn = []
    version++
  }

  function fail(why: string): void {
    if (disabled) return
    disabled = true
    console.error(`Basemap off: ${why}`)
    stop()
  }

  /** The view's ground footprint into `footprint`; allocation-free. */
  function measure(pose: ViewPose, camera: PerspectiveCamera): void {
    camera.updateMatrixWorld()
    rays.p[0] = camera.position.x
    rays.p[1] = camera.position.y
    rays.p[2] = camera.position.z
    for (let i = 0; i < 4; i++) {
      v.set(CORNERS[i * 2]!, CORNERS[i * 2 + 1]!, 0.5).unproject(camera).sub(camera.position)
      rays.dirs[i * 3] = v.x
      rays.dirs[i * 3 + 1] = v.y
      rays.dirs[i * 3 + 2] = v.z
    }
    rays.distance = pose.distance
    groundFootprint(rays, footprint)
  }

  function select(pose: ViewPose, camera: PerspectiveCamera): void {
    chosen.set(footprint)
    hasChosen = true
    const metersPerScreenPx = (2 * pose.distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, pose.height)
    const zz = zoomFor(metersPerScreenPx, capZ === null ? config.maxzoom : Math.min(config.maxzoom, capZ))
    const picked = selectTiles(footprint, { x: pose.tx, z: pose.tz }, pose.distance, zz, config.bbox)
    z = picked.z
    setWanted(picked.tiles)
  }

  return {
    start() {
      if (worker !== null || disabled) return
      const w = createWorker()
      if (w === null) return fail('this browser has no Web Workers')
      worker = w
      w.onerror = (e) => fail(`the tile worker failed (${e.message || 'worker error'})`)
      w.onmessageerror = () => fail('the tile worker sent an unreadable reply')
      w.onmessage = (e) => onReply(e.data)
      post({ type: 'init', layers: config.layers })
    },
    update(pose, camera, nowMs) {
      if (worker === null) return
      clock = nowMs
      if (nowMs >= nextRetryAt) {
        nextRetryAt = Infinity
        pump()
      }
      measure(pose, camera)
      const slidOut = hasChosen && !footprintInside(footprint, chosen, MARGIN * pose.distance)
      if (!reselectDue(reselect, pose, nowMs, slidOut)) return
      markSelected(reselect, pose, nowMs)
      select(pose, camera)
    },
    capZoom(cap) {
      capZ = cap
      if (cap !== null) cancelWhere((key) => keyZ(key) > cap)
      reselect = newReselect()
    },
    get version() {
      return version
    },
    get z() {
      return z
    },
    get drawn() {
      return drawn
    },
    stats: () => ({
      disabled,
      capZ,
      z,
      wanted: wanted.length,
      drawn: drawn.length,
      inFlight: inflight.size,
      ...counts,
      cachedTiles: lru.size,
      cachedBytes: lru.bytes,
      decodeMs: { count: decode.count, mean: decode.count > 0 ? decode.total / decode.count : 0, max: decode.max },
      log: [...requestLog],
    }),
    dispose: stop,
  }
}
