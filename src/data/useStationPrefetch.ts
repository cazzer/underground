import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useFocus } from '../lib/focus'
import type { ViewStationSet } from '../lib/viewStationSet'
import type { IndexLoad } from './interiorLoad'
import { prefetchTargets } from './stationPrefetch'
import { prefetchInteriors } from './useStationInterior'
import { prefetchStreetLayers } from './useStationStreets'

/**
 * Warms the interior and street caches for the stations the camera is about to reveal (o3r.8), without mounting
 * anything: `set` is useViewStations' prefetch set (stations in the free rect within reach of the target while the
 * camera is under PREFETCH_FAR, nearest first), `index` the station index (no interior file is named before it is
 * ready) and `interiorCap` viewInteriorCap of the window. Drawing stays gated at REVEAL_FAR, so a view interior or
 * street layer later finds its model in the cache.
 *
 * Privacy: the ids come only from `set`, which is camera-driven and empty while the location cap is in force, so a
 * prefetch never names the station a location flight landed on, and nothing here reads the fix or its nearest station.
 * These are the same files the view fetches would load a moment later, the same class as the view set's.
 */
export function useStationPrefetch(set: ViewStationSet, index: IndexLoad, interiorCap: number): void {
  const ids = useSyncExternalStore(set.subscribe, set.get)
  const { focusedId, membersOf } = useFocus()
  const targets = useMemo(() => prefetchTargets(ids, focusedId, index, interiorCap), [ids, focusedId, index, interiorCap])
  const interiors = targets.interiors.join(',')
  const streets = targets.streets.join(',')
  useEffect(() => {
    if (interiors !== '') prefetchInteriors(interiors.split(','))
  }, [interiors])
  useEffect(() => {
    if (streets !== '') prefetchStreetLayers(streets.split(','), membersOf)
  }, [streets, membersOf])
}
