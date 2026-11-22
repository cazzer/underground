/**
 * The basemap tile store (no React): picks the tiles the view needs, loads them through the basemap worker (at
 * most MAX_IN_FLIGHT at a time, nearest the view center first, unwanted ones cancelled), keeps decoded tiles in
 * an LRU and says what to draw meanwhile (tileCover.ts). Nothing loads until `start`; a missing or crashed worker
 * turns the basemap off (logged once), with no main-thread fallback.
 */
import { Vector3, type PerspectiveCamera } from 'three'
import type { ClassBuffers } from '../lib/basemap/decodeTile'
import { groundFootprint, selectTiles, type WantedTile } from '../lib/basemap/footprint'
import { markSelected, newReselect, reselectDue, type ViewPose } from '../lib/basemap/reselect'
import { drawnTiles } from '../lib/basemap/tileCover'
import { createTileLru } from '../lib/basemap/tileLru'
import { keyX, keyY, keyZ, MIN_Z, zoomFor } from '../lib/basemap/tileMath'
import { tileUrl, type BasemapConfig } from './basemapConfig'
import type { BasemapReply, BasemapRequest } from './basemapProtocol'

export const MAX_IN_FLIGHT = 6
/** A tile that failed to load (network, 5xx) is asked for again after this long, if still wanted. */
export const RETRY_MS = 15_000

export interface BasemapTile {
  key: number
  z: number
  x: number
  y: number
  classes: ClassBuffers
  bytes: number
}

export interface BasemapStats {
  disabled: boolean
  held: boolean
  z: number
  wanted: number
  drawn: number
  inFlight: number
  requested: number
  loaded: number
  missing: number
  notMvt: number
  errors: number
  cancelled: number
  cachedTiles: number
  cachedBytes: number
  decodeMs: { count: number; mean: number; max: number }
}

export interface BasemapTiles {
  /** Creates the worker; until then (and after `dispose`) `update` does nothing. */
  start(): void
  /** Once per frame, `nowMs` from performance.now(): allocation-free unless the view changed enough to pick tiles again. */
  update(pose: ViewPose, camera: PerspectiveCamera, nowMs: number): void
  /** While held no new tile is requested; tiles already loaded still draw. */
  hold(on: boolean): void
  /** Bumped whenever `drawn` changes. */
  readonly version: number
  /** The zoom of the wanted tiles. */
  readonly z: number
  readonly drawn: readonly BasemapTile[]
  stats(): BasemapStats
  dispose(): void
}

/** The four frustum corners in NDC, in the order groundFootprint expects. */
const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1]

export function createBasemapTiles(config: BasemapConfig): BasemapTiles {
  let worker: Worker | null = null
  let disabled = false
  let held = false
  let reselect = newReselect()
  let z = MIN_Z
  let wanted: WantedTile[] = []
  let wantedKeys = new Set<number>()
  const lru = createTileLru<BasemapTile>()
  const empty = new Set<number>()
  const retryAt = new Map<number, number>()
  /** The soonest retry of a wanted tile, so a frame checks one number. */
  let nextRetryAt = Infinity
  const inflight = new Set<number>()
  let drawnKeys: number[] = []
  let drawnSet = new Set<number>()
  let drawn: BasemapTile[] = []
  let version = 0
  const counts = { requested: 0, loaded: 0, missing: 0, notMvt: 0, errors: 0, cancelled: 0 }
  const decode = { count: 0, total: 0, max: 0 }
  const logged = new Set<string>()
  const rays = { p: new Float64Array(3), dirs: new Float64Array(12), distance: 0 }
  const footprint = new Float64Array(8)
  const v = new Vector3()

  const logOnce = (reason: string, log: () => void) => {
    if (logged.has(reason)) return
    logged.add(reason)
    log()
  }
  const post = (msg: BasemapRequest) => worker?.postMessage(msg)
  const place = (key: number) => `${keyZ(key)}/${keyX(key)}/${keyY(key)}`

  function recomputeDrawn(): void {
    const keys = drawnTiles([...wantedKeys], (k) => lru.has(k) || empty.has(k), drawnKeys).filter((k) => lru.has(k))
    if (keys.length === drawnKeys.length && keys.every((k, i) => k === drawnKeys[i])) return
    drawnKeys = keys
    drawnSet = new Set(keys)
    drawn = keys.map((k) => lru.peek(k)!)
    for (const k of keys) lru.touch(k)
    version++
  }

  function pump(nowMs: number): void {
    if (worker === null || held) return
    for (const t of wanted) {
      if (inflight.size >= MAX_IN_FLIGHT) return
      if (inflight.has(t.key) || lru.has(t.key) || empty.has(t.key)) continue
      const at = retryAt.get(t.key) ?? -Infinity
      if (at > nowMs) {
        nextRetryAt = Math.min(nextRetryAt, at)
        continue
      }
      inflight.add(t.key)
      counts.requested++
      post({ type: 'load', key: t.key, url: tileUrl(config, t.z, t.x, t.y), z: t.z, x: t.x, y: t.y })
    }
  }

  function setWanted(tiles: WantedTile[], nowMs: number): void {
    wanted = tiles
    wantedKeys = new Set(tiles.map((t) => t.key))
    for (const key of inflight) {
      if (wantedKeys.has(key)) continue
      inflight.delete(key)
      counts.cancelled++
      post({ type: 'cancel', key })
    }
    recomputeDrawn()
    pump(nowMs)
  }

  function onReply(reply: BasemapReply): void {
    const { key } = reply
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
      const at = performance.now() + RETRY_MS
      retryAt.set(key, at)
      nextRetryAt = Math.min(nextRetryAt, at)
      logOnce('error', () => console.error(`Basemap tile ${place(key)} failed to load (${reply.message}); retrying in ${RETRY_MS / 1000} s`))
    }
    recomputeDrawn()
    lru.evict((k) => drawnSet.has(k) || wantedKeys.has(k))
    pump(performance.now())
  }

  function stop(): void {
    worker?.terminate()
    worker = null
    reselect = newReselect()
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

  function select(pose: ViewPose, camera: PerspectiveCamera, nowMs: number): void {
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
    const metersPerScreenPx = (2 * pose.distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, pose.height)
    const picked = selectTiles(footprint, { x: pose.tx, z: pose.tz }, pose.distance, zoomFor(metersPerScreenPx, config.maxzoom), config.bbox)
    z = picked.z
    setWanted(picked.tiles, nowMs)
  }

  return {
    start() {
      if (worker !== null || disabled) return
      if (typeof Worker === 'undefined') return fail('this browser has no Web Workers')
      worker = new Worker(new URL('./basemapWorker.ts', import.meta.url), { type: 'module' })
      worker.onerror = (e) => fail(`the tile worker failed (${e.message || 'worker error'})`)
      worker.onmessageerror = () => fail('the tile worker sent an unreadable reply')
      worker.onmessage = (e: MessageEvent<BasemapReply>) => onReply(e.data)
      post({ type: 'init', layers: config.layers })
    },
    update(pose, camera, nowMs) {
      if (worker === null) return
      if (nowMs >= nextRetryAt && !held) {
        nextRetryAt = Infinity
        pump(nowMs)
      }
      if (!reselectDue(reselect, pose, nowMs)) return
      markSelected(reselect, pose, nowMs)
      select(pose, camera, nowMs)
    },
    hold(on) {
      held = on
      if (!on) pump(performance.now())
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
      held,
      z,
      wanted: wanted.length,
      drawn: drawn.length,
      inFlight: inflight.size,
      ...counts,
      cachedTiles: lru.size,
      cachedBytes: lru.bytes,
      decodeMs: { count: decode.count, mean: decode.count > 0 ? decode.total / decode.count : 0, max: decode.max },
    }),
    dispose: stop,
  }
}
