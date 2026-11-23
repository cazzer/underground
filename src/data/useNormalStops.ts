import { useEffect, useMemo, useState } from 'react'
import type { ShapeId, TripIndexFile } from './schema'
import { serviceIndex, type NormalService } from '../lib/live/alertAdded'
import type { Network } from '../lib/network'
import { primaryKey, type TripLookup } from '../lib/realtime/tripLookup'

type Fallback = { kind: 'idle' } | { kind: 'ready'; patterns: TripIndexFile['patterns'] } | { kind: 'failed' }

/**
 * Normal service by route and direction (alertAdded.ts), for an Express to Local change's added stops. The live
 * layer's TripLookup (its static load, ready before any snapshot; no fetch of our own); `'loading'` while that load
 * runs. Only when it failed (or live data is off) and `wanted` (a snapshot holds such a change): the trip planner's
 * patterns (`tripPatterns()`, its one trip-index fetch) with the network's primary shapes, `'loading'` meanwhile. Null
 * when no source will come (a failed fallback logs once, or nothing is wanted): the change then lists as a plain notice.
 */
export function useNormalStops(lookup: TripLookup | null, lookupFailed: boolean, wanted: boolean, network: Network): NormalService {
  const [fallback, setFallback] = useState<Fallback>({ kind: 'idle' })
  const fetchNow = lookup === null && lookupFailed && wanted && fallback.kind === 'idle'
  useEffect(() => {
    if (!fetchNow) return
    let live = true
    import('./loadTimetable')
      .then((m) => m.tripPatterns())
      .then((patterns) => {
        if (live) setFallback({ kind: 'ready', patterns })
      })
      .catch((err: unknown) => {
        console.error(`Normal service for local changes not loaded: ${err instanceof Error ? err.message : String(err)}`)
        if (live) setFallback({ kind: 'failed' })
      })
    return () => {
      live = false
    }
  }, [fetchNow])
  const primary = useMemo(() => {
    const map = new Map<string, ShapeId>()
    for (const s of network.shapes) if (s.primary) map.set(primaryKey(s.routeId, s.direction), s.id)
    return map
  }, [network])
  const patterns = fallback.kind === 'ready' ? fallback.patterns : null
  const index = useMemo(() => {
    if (lookup !== null) return serviceIndex(lookup, network.stationById)
    return patterns !== null ? serviceIndex({ patterns, primary }, network.stationById) : null
  }, [lookup, patterns, primary, network])
  if (index !== null) return index
  if (!lookupFailed) return 'loading'
  return wanted && fallback.kind !== 'failed' ? 'loading' : null
}
