import { useEffect, useState } from 'react'
import { createInteriorCache } from './interiorCache'
import { decodeStationWalk, loadStationWalk } from './loadStationWalk'
import type { WalkGraph } from './walkSchema'

const BASE_URL = import.meta.env.BASE_URL

/**
 * One fetch per station per page load, decoded inside the promise so a data error rejects (and is evicted, so the
 * next use retries). A station with no walk file resolves to null, which stays cached.
 */
const cache = createInteriorCache((id) => loadStationWalk(BASE_URL, id).then((file) => file && decodeStationWalk(file)))

/**
 * A station's walk graph, once loaded; null while loading, with no station, with no walk file, or after a failure
 * (logged). Nothing is fetched until `stationId` is set.
 *
 * Privacy: the request reveals the station id to the static host, so pass only a station the user picked, focused, or
 * chose as a trip endpoint, never the station nearest a location fix without a user action. See loadStationWalk.ts.
 */
export function useStationWalk(stationId: string | null): WalkGraph | null {
  // The last station whose load settled: set only to re-render once the cache holds it.
  const [, setLoadedId] = useState<string | null>(null)

  useEffect(() => {
    if (!stationId || cache.peek(stationId) !== undefined) return
    let cancelled = false
    cache.get(stationId).then(
      () => {
        if (!cancelled) setLoadedId(stationId)
      },
      (err: unknown) => {
        console.error(`Failed to load the walk graph of station ${stationId}`, err)
      },
    )
    return () => {
      cancelled = true
    }
  }, [stationId])

  return (stationId && cache.peek(stationId)) || null
}
