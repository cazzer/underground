import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ArrivalsSource } from '../lib/live/arrivals'
import { clockNow } from '../lib/live/clock'
import { deriveLiveStatus, type LiveStatus } from '../lib/live/liveStatus'
import type { JoinStage } from '../lib/realtime/joinTrip'
import type { TripLookup } from '../lib/realtime/tripLookup'
import { carryMemory, prepareTrips, type CarriedMemory, type DropReason, type LiveTrip } from '../lib/realtime/prepareTrips'
import type { DrawnShapes } from './loadRealtimeStatic'
import type { NetworkFiles } from './loadNetwork'
import { FEED_IDS, RT_URL, type FeedId } from './realtime'
import type { ShapeId, TripPattern } from './schema'
import { useRealtimeFeed } from './useRealtimeFeed'
import { useRealtimeStatic } from './useRealtimeStatic'
import { useOnline } from './useOnline'

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
  /** Drawn trips whose arrival comes from the schedule from their last stop, not the feed's prediction. */
  capped: number
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
  /** For the station panel's arrivals; null until there is a snapshot and the join data. */
  arrivals: ArrivalsSource | null
  /** The join data's trip lookup once the static load is ready (before any snapshot); null until then. */
  lookup: TripLookup | null
  /** The lookup will never come: live data is off, or its static load failed. */
  lookupFailed: boolean
  /** The technical cause behind a failed or fatal state, for `?debug` (it is already in the console). */
  technical: string | null
  /** For the error boundary around the live layer: a render crash shows in the HUD instead of blanking the map. */
  onLayerError: (error: Error) => void
}

/**
 * Live trains: loads the join data, polls the Worker, and places the trips once per snapshot.
 * With no `VITE_RT_URL` nothing is fetched and the status says so. `files` is null until the network is ready.
 * `trackOffsetM` and `drawn` are `network.trackOffsetM` and useNetwork's `bands`, so trains ride the tracks (and bands) the map draws.
 */
export function useLive(
  files: NetworkFiles | null,
  trackOffsetM: number,
  drawn: DrawnShapes | null,
): Live {
  const configured = RT_URL !== null
  const staticLoad = useRealtimeStatic(configured ? files : null, trackOffsetM, drawn)
  const feed = useRealtimeFeed(RT_URL)
  const [layerError, setLayerError] = useState<string | null>(null)
  const onLayerError = useCallback((e: Error) => setLayerError(e.message), [])

  useEffect(() => {
    if (!configured) console.info('Live trains off: VITE_RT_URL is not set (copy .env.example to .env.local)')
  }, [configured])

  // Trip memory from the last polls (kept one poll for a trip that drops out): a fallback join that is a tie keeps
  // its shape instead of flapping, and a trip's last stop and origin carry into its next plan.
  const previousTrips = useRef<ReadonlyMap<string, CarriedMemory>>(new Map())

  const { snapshot, offsetS } = feed
  const data = staticLoad.status === 'ready' ? staticLoad.data : null
  const prepared = useMemo(() => {
    if (!data || !snapshot || offsetS === null) return null
    const started = performance.now()
    try {
      const now = clockNow(offsetS, started)
      const result = prepareTrips(snapshot, data, now, previousTrips.current)
      previousTrips.current = carryMemory(previousTrips.current, result.trips)
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

  const arrivals = useMemo<ArrivalsSource | null>(
    () =>
      data && snapshot && offsetS !== null
        ? { snapshot, offsetS, lookup: data.lookup, failures: feed.failures, drawnKeys: new Set(layer?.trips.map((t) => t.key)) }
        : null,
    [data, snapshot, offsetS, feed.failures, layer],
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
      capped: placed.trips.filter((t) => t.plan.capped).length,
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
  const online = useOnline()
  const status = deriveLiveStatus({
    configured,
    fatal: fatalError !== null,
    staticReady: staticLoad.status === 'ready',
    snapshot,
    failures: feed.failures,
    schemaMismatch: feed.schemaMismatch,
    // Re-evaluated whenever a poll lands, so the age check needs no timer of its own.
    nowS: offsetS === null ? 0 : clockNow(offsetS, performance.now()),
    online,
  })

  return { status, layer, debug, arrivals, lookup: data?.lookup ?? null, lookupFailed: !configured || staticError !== null, technical: fatalError ?? feed.lastError, onLayerError }
}
