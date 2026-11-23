import { useEffect, useMemo, useState } from 'react'
import type { ShapeId, TripIndexFile } from './schema'
import { serviceIndex, type ServiceOf } from '../lib/live/alertAdded'
import type { Network } from '../lib/network'
import { primaryKey, type TripLookup } from '../lib/realtime/tripLookup'

/**
 * Normal service by route and direction (alertAdded.ts), for an Express to Local change's added stops. The live
 * layer's TripLookup when it has loaded (no fetch of our own); else, only while `wanted` (a snapshot holds such a
 * change), the trip planner's patterns (`tripPatterns()`, its one trip-index fetch) with the network's primary shapes.
 * Null until either is there; a failed load logs once and stays null (the change is then listed as a plain notice).
 */
export function useNormalStops(lookup: TripLookup | null, wanted: boolean, network: Network): ServiceOf | null {
  const [patterns, setPatterns] = useState<TripIndexFile['patterns'] | null>(null)
  const fetchNow = lookup === null && wanted && patterns === null
  useEffect(() => {
    if (!fetchNow) return
    let live = true
    import('./loadTimetable')
      .then((m) => m.tripPatterns())
      .then((p) => {
        if (live) setPatterns(p)
      })
      .catch((err: unknown) => console.error(`Normal service for local changes not loaded: ${err instanceof Error ? err.message : String(err)}`))
    return () => {
      live = false
    }
  }, [fetchNow])
  const primary = useMemo(() => {
    const map = new Map<string, ShapeId>()
    for (const s of network.shapes) if (s.primary) map.set(primaryKey(s.routeId, s.direction), s.id)
    return map
  }, [network])
  return useMemo(() => {
    if (lookup !== null) return serviceIndex(lookup, network.stationById)
    return patterns !== null ? serviceIndex({ patterns, primary }, network.stationById) : null
  }, [lookup, patterns, primary, network])
}
