import type { IndexLoad } from '../data/interiorLoad'
import { useStationPrefetch } from '../data/useStationPrefetch'
import type { ViewStationSet } from '../lib/viewStationSet'

export interface StationPrefetchSourceProps {
  /** useViewStations' prefetch set. */
  set: ViewStationSet
  index: IndexLoad
  /** How many interiors draw at once (viewInteriorCap): the prefetch warms a couple more. */
  interiorCap: number
}

/** Warms the caches for the stations the camera is about to reveal (o3r.8); draws nothing. */
export function StationPrefetchSource({ set, index, interiorCap }: StationPrefetchSourceProps): null {
  useStationPrefetch(set, index, interiorCap)
  return null
}
