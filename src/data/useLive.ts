import { useCallback, useEffect, useMemo, useState } from 'react'
import { clockNow } from '../lib/live/clock'
import { deriveLiveStatus, type LiveStatus } from '../lib/live/liveStatus'
import type { JoinStage } from '../lib/realtime/joinTrip'
import { prepareTrips, type DropReason, type LiveTrip } from '../lib/realtime/prepareTrips'
import type { NetworkFiles } from './loadNetwork'
import { FEED_IDS, RT_URL, type FeedId } from './realtime'
import type { ShapeId, TripPattern } from './schema'
import { useRealtimeFeed } from './useRealtimeFeed'
import { useRealtimeStatic } from './useRealtimeStatic'

/** What the scene draws: this poll's placed trips, and the clock to evaluate them against. */
export interface LiveLayer {
  trips: readonly LiveTrip[]
  offsetS: number
  patterns: Readonly<Record<ShapeId, TripPattern>>
}

/** Per-poll numbers for the `?debug` overlay. */
export interface LiveDebugInfo {
  drawn: number
  dropped: Record<DropReason, number>
  stages: Record<JoinStage, number>
  perFeed: Record<FeedId, { trips: number; stale: boolean; error: string | null }>
  cache: string | null
  prepareMs: number
  offsetS: number
  /** Device clock minus live clock, seconds; mostly the device clock's own error plus the memo age. */
  skewS: number
  ageS: number
  failures: number
}

export interface Live {
  status: LiveStatus
  layer: LiveLayer | null
  debug: LiveDebugInfo | null
  /** The technical cause behind a failed or fatal state, for `?debug` (it is already in the console). */
  technical: string | null
  /** For the error boundary around the live layer: a render crash shows in the HUD instead of blanking the map. */
  onLayerError: (error: Error) => void
}

/**
 * Live trains: loads the join data, polls the Worker, and places the trips once per snapshot.
 * With no `VITE_RT_URL` nothing is fetched and the status says so. `files` is null until the network is ready.
 */
export function useLive(files: NetworkFiles | null): Live {
  const configured = RT_URL !== null
  const staticLoad = useRealtimeStatic(configured ? files : null)
  const feed = useRealtimeFeed(RT_URL)
  const [layerError, setLayerError] = useState<string | null>(null)
  const onLayerError = useCallback((e: Error) => setLayerError(e.message), [])

  useEffect(() => {
    if (!configured) console.info('Live trains off: VITE_RT_URL is not set (copy .env.example to .env.local)')
  }, [configured])

  const { snapshot, offsetS } = feed
  const data = staticLoad.status === 'ready' ? staticLoad.data : null
  const prepared = useMemo(() => {
    if (!data || !snapshot || offsetS === null) return null
    const started = performance.now()
    try {
      const now = clockNow(offsetS, started)
      const result = prepareTrips(snapshot, data, now)
      return { ok: true as const, ...result, ms: performance.now() - started, now }
    } catch (err) {
      console.error('Failed to place live trips', err)
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  }, [data, snapshot, offsetS])

  const prepareError = prepared && !prepared.ok ? prepared.error : null
  const placed = prepared?.ok ? prepared : null

  const layer = useMemo<LiveLayer | null>(
    () =>
      data && placed && offsetS !== null && layerError === null
        ? { trips: placed.trips, offsetS, patterns: data.lookup.patterns }
        : null,
    [data, placed, offsetS, layerError],
  )

  const debug = useMemo<LiveDebugInfo | null>(() => {
    if (!placed || !snapshot || offsetS === null) return null
    const stages: Record<JoinStage, number> = { path: 0, tripKey: 0, primary: 0 }
    for (const t of placed.trips) stages[t.stage]++
    const perFeed = Object.fromEntries(
      FEED_IDS.map((f) => [f, { trips: snapshot.feeds[f].trips.length, stale: snapshot.feeds[f].stale, error: snapshot.feeds[f].error }]),
    ) as LiveDebugInfo['perFeed']
    return {
      drawn: placed.trips.length,
      dropped: placed.dropped,
      stages,
      perFeed,
      cache: feed.cache,
      prepareMs: placed.ms,
      offsetS,
      skewS: Date.now() / 1000 - placed.now,
      ageS: placed.now - snapshot.generatedAt,
      failures: feed.failures,
    }
  }, [placed, snapshot, offsetS, feed.cache, feed.failures])

  const staticError = staticLoad.status === 'error' ? staticLoad.message : null
  const fatalError = staticError ?? prepareError ?? layerError
  const status = deriveLiveStatus({
    configured,
    fatal: fatalError !== null,
    staticReady: staticLoad.status === 'ready',
    snapshot,
    failures: feed.failures,
    schemaMismatch: feed.schemaMismatch,
    // Re-evaluated whenever a poll lands, so the age check needs no timer of its own.
    nowS: offsetS === null ? 0 : clockNow(offsetS, performance.now()),
  })

  return { status, layer, debug, technical: fatalError ?? feed.lastError, onLayerError }
}
