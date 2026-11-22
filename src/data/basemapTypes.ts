/** The basemap tile store's public shape (basemapTiles.ts) and the worker it drives. */
import type { PerspectiveCamera } from 'three'
import type { ClassBuffers } from '../lib/basemap/decodeTile'
import type { ViewPose } from '../lib/basemap/reselect'
import type { BasemapReply, BasemapRequest } from './basemapProtocol'

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
  /** The location zoom cap in force, or null. */
  capZ: number | null
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
  /** Replies dropped because their tile was cancelled or asked for again since. */
  stale: number
  cachedTiles: number
  cachedBytes: number
  decodeMs: { count: number; mean: number; max: number }
  /** The z/x/y of the last 200 tiles asked for, in order (for `__underground.basemap()`). */
  log: string[]
  /** performance.now() of the first tile asked for, or null. */
  firstRequestMs: number | null
}

export interface BasemapTiles {
  /** Creates the worker; until then (and after `dispose`) `update` does nothing. */
  start(): void
  /** Once per frame, `nowMs` from performance.now(): allocation-free unless the view changed enough to pick tiles again. */
  update(pose: ViewPose, camera: PerspectiveCamera, nowMs: number): void
  /** Loads no tile finer than `z` (null: no cap). Either way the next `update` picks tiles for the current view. */
  capZoom(z: number | null): void
  /** Bumped whenever `drawn` changes. */
  readonly version: number
  /** The zoom of the wanted tiles. */
  readonly z: number
  readonly drawn: readonly BasemapTile[]
  stats(): BasemapStats
  dispose(): void
}

/** The part of a Worker the store uses, so tests can drive it with a fake. */
export interface BasemapWorkerLike {
  postMessage(message: BasemapRequest): void
  terminate(): void
  onmessage: ((e: MessageEvent<BasemapReply>) => void) | null
  onerror: ((e: ErrorEvent) => void) | null
  onmessageerror: ((e: MessageEvent) => void) | null
}
