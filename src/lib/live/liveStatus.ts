import { FEED_IDS, STALE_AFTER_S, type FeedId, type RealtimeSnapshot } from '../../data/realtime'

export type LiveStatusKind = 'off' | 'connecting' | 'live' | 'stale' | 'error'

export interface LiveStatus {
  kind: LiveStatusKind
  /** Short, plain-language state; this is what a screen reader announces. */
  label: string
  /** Extra user-facing context (which lines are delayed); never technical text. */
  detail: string | null
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
  if (!i.configured) return { kind: 'off', label: 'Live trains off', detail: 'Not available yet' }
  if (i.fatal) return { kind: 'error', label: 'Live trains unavailable, reload to retry', detail: null }
  if (i.schemaMismatch) return { kind: 'error', label: 'Update available, reload', detail: null }
  if (i.snapshot === null && i.failures >= 1) return { kind: 'error', label: 'Live trains unavailable, retrying', detail: null }
  if (i.snapshot === null || !i.staticReady) return { kind: 'connecting', label: 'Connecting to live trains', detail: null }
  if (i.failures >= 2) return { kind: 'stale', label: 'Live data delayed', detail: null }
  const { feeds, generatedAt } = i.snapshot
  const delayed = FEED_IDS.filter((f) => feeds[f].stale).map((f) => FEED_LABELS[f])
  const detail = delayed.length > 0 ? `Delayed: ${delayed.join(', ')}` : null
  if (i.nowS - generatedAt > STALE_AFTER_S) return { kind: 'stale', label: 'Live data delayed', detail }
  if (delayed.length > 0) return { kind: 'stale', label: 'Live, some lines delayed', detail }
  return { kind: 'live', label: 'Live trains', detail: null }
}
