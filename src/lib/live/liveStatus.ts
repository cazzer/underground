import { FEED_IDS, STALE_AFTER_S, type FeedId, type RealtimeSnapshot } from '../../data/realtime'

export type LiveStatusKind = 'off' | 'connecting' | 'live' | 'stale' | 'error'

export interface LiveStatus {
  kind: LiveStatusKind
  /** Short, plain-language state; this is what a screen reader announces. */
  label: string
  /** Extra user-facing context (which lines are delayed); never technical text. */
  detail: string | null
  /** Epoch seconds of the data still drawn, when it may be out of date (offline or delayed); shown as "updated 2:41 PM". */
  updatedAt: number | null
}

export interface LiveStatusInput {
  /** False when no realtime URL is set: there is nothing to show. */
  configured: boolean
  /** A failed load of the join data, a failed placement, or a crashed live layer: only a reload helps. */
  fatal: boolean
  /** The join data (trip-index, segments) has loaded. */
  staticReady: boolean
  snapshot: RealtimeSnapshot | null
  /** Consecutive failed polls. */
  failures: number
  /** The Worker speaks a newer snapshot version than this build. */
  schemaMismatch: boolean
  /** Live-clock epoch seconds. */
  nowS: number
  /** navigator.onLine: false the moment the device reports it lost its connection (a tunnel, airplane mode). */
  online: boolean
}

export const FEED_LABELS: Record<FeedId, string> = {
  '1234567': '1–7',
  ace: 'ACE',
  bdfm: 'BDFM',
  g: 'G',
  jz: 'JZ',
  nqrw: 'NQRW',
  l: 'L',
  si: 'SIR',
}

/**
 * What the HUD says about live trains. Technical causes (HTTP codes, messages) never appear here: they go to
 * the console and the `?debug` overlay. One failed poll while a snapshot exists is not shown; two in a
 * row are, as a delay (the trains are still drawn) unless there is nothing to draw.
 */
export function deriveLiveStatus(i: LiveStatusInput): LiveStatus {
  const none = { detail: null, updatedAt: null }
  if (!i.configured) return { kind: 'off', label: 'Live trains off', detail: 'Not available yet', updatedAt: null }
  if (i.fatal) return { kind: 'error', label: 'Live trains unavailable, reload to retry', ...none }
  if (i.schemaMismatch) return { kind: 'error', label: 'Update available, reload', ...none }
  if (i.snapshot === null && !i.online) return { kind: 'error', label: 'Offline, no live trains yet', ...none }
  if (i.snapshot === null && i.failures >= 1) return { kind: 'error', label: 'Live trains unavailable, retrying', ...none }
  if (i.snapshot === null || !i.staticReady) return { kind: 'connecting', label: 'Connecting to live trains', ...none }
  const { feeds, generatedAt } = i.snapshot
  // Offline shows at once (the device says so); failed polls only from the second in a row.
  if (!i.online) return { kind: 'stale', label: 'Offline, showing last update', detail: null, updatedAt: generatedAt }
  if (i.failures >= 2) return { kind: 'stale', label: 'Live data delayed', detail: null, updatedAt: generatedAt }
  const delayed = FEED_IDS.filter((f) => feeds[f].stale).map((f) => FEED_LABELS[f])
  const detail = delayed.length > 0 ? `Delayed: ${delayed.join(', ')}` : null
  if (i.nowS - generatedAt > STALE_AFTER_S) return { kind: 'stale', label: 'Live data delayed', detail, updatedAt: generatedAt }
  if (delayed.length > 0) return { kind: 'stale', label: 'Live, some lines delayed', detail, updatedAt: null }
  return { kind: 'live', label: 'Live trains', ...none }
}
