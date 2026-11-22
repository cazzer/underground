/** Messages between basemapTiles.ts (main thread) and basemapWorker.ts. Tiles are named by tileKey. */
import type { ClassBuffers } from '../lib/basemap/decodeTile'

export type BasemapRequest =
  /** Sent once, first: the spec's kept layers, the only ones decoded. */
  | { type: 'init'; layers: string[] }
  | { type: 'load'; key: number; url: string; z: number; x: number; y: number }
  /** Aborts the fetch; a cancelled tile is never decoded or answered. */
  | { type: 'cancel'; key: number }

/** Why a tile has nothing to draw, for good: not served (404), or not raw MVT (an HTML fallback, gzip, a bad tile). */
export type EmptyReason = 'missing' | 'not-mvt'

export type BasemapReply =
  /** The buffers are transferred. `bodyBytes` is the response body's length (after any HTTP decompression). */
  | { type: 'tile'; key: number; classes: ClassBuffers; decodeMs: number; bodyBytes: number }
  | { type: 'empty'; key: number; reason: EmptyReason; detail: string }
  /** A network failure or an unexpected status: worth a retry later. */
  | { type: 'error'; key: number; message: string }
