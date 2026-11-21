import { FEED_IDS, STALE_AFTER_S, type FeedId, type RealtimeSnapshot } from '../../data/realtime'

export type LiveStatusKind = 'off' | 'connecting' | 'live' | 'stale' | 'error'

export interface LiveStatus {
  kind: LiveStatusKind
  label: string
  detail: string | null
}

export interface LiveStatusInput {
  /** False when no realtime URL is set: there is nothing to show. */
  configured: boolean
  staticError: string | null
  prepareError: string | null
  layerError: string | null
  snapshot: RealtimeSnapshot | null
  /** Consecutive failed polls. */
  failures: number
  lastError: string | null
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
 * What the HUD says about live trains, from the loader and poller state. One failed poll while a
 * snapshot exists is not shown (the next poll is soon); two in a row are. Nothing here is time-varying
 * text, so the live region it feeds doesn't chatter.
 */
export function deriveLiveStatus(i: LiveStatusInput): LiveStatus {
  if (!i.configured) return { kind: 'off', label: 'Live trains off', detail: 'No realtime source configured' }
  const fatal = i.staticError ?? i.prepareError ?? i.layerError
  if (fatal !== null) return { kind: 'error', label: 'Live trains unavailable', detail: fatal }
  if (i.failures >= 2 || (i.failures >= 1 && i.snapshot === null)) {
    return {
      kind: 'error',
      label: i.snapshot === null ? 'Live data unavailable, retrying' : 'Live data delayed, retrying',
      detail: i.lastError,
    }
  }
  if (i.snapshot === null) return { kind: 'connecting', label: 'Connecting to live trains', detail: null }
  const { feeds, generatedAt } = i.snapshot
  const delayed = FEED_IDS.filter((f) => feeds[f].stale).map((f) => FEED_LABELS[f])
  const detail = delayed.length > 0 ? `Delayed: ${delayed.join(', ')}` : null
  if (i.nowS - generatedAt > STALE_AFTER_S) return { kind: 'stale', label: 'Live data delayed', detail }
  if (delayed.length > 0) return { kind: 'stale', label: 'Live, some lines delayed', detail }
  return { kind: 'live', label: 'Live', detail: null }
}
