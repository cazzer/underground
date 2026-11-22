/**
 * Messages between basemapTiles.ts (main thread) and basemapWorker.ts. Tiles are named by tileKey; every load
 * carries a sequence number its reply echoes, so a reply to a load since cancelled or repeated is told apart.
 */
import type { ClassBuffers } from '../lib/basemap/decodeTile'
import type { PackedTracks } from '../lib/routeTracks'

export type BasemapRequest =
  /** Sent once, first: the spec's kept layers, the only ones decoded, and the drawn tracks the roads are cut under. */
  | { type: 'init'; layers: string[]; tracks: PackedTracks }
  | { type: 'load'; key: number; seq: number; url: string; z: number; x: number; y: number }
  /** Aborts the fetch; a cancelled tile is never decoded or answered. */
  | { type: 'cancel'; key: number }

/** Why a tile has nothing to draw, for good: not served (404), or not raw MVT (an HTML fallback, gzip, a bad tile). */
export type EmptyReason = 'missing' | 'not-mvt'

export type BasemapReply =
  /** The buffers are transferred. `bodyBytes` is the response body's length (after any HTTP decompression). */
  | { type: 'tile'; key: number; seq: number; classes: ClassBuffers; decodeMs: number; bodyBytes: number }
  | { type: 'empty'; key: number; seq: number; reason: EmptyReason; detail: string }
  /** A network failure or an unexpected status: worth a retry later. */
  | { type: 'error'; key: number; seq: number; message: string }
