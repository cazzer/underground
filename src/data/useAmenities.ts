import { useEffect, useState } from 'react'
import type { AmenitiesFile } from './amenitiesSchema'
import { createInteriorCache } from './interiorCache'
import { loadAmenities } from './loadAmenities'

const BASE_URL = import.meta.env.BASE_URL

export type AmenitiesLoad = { state: 'loading' } | { state: 'ready'; index: AmenitiesFile } | { state: 'error' }

/** The amenities file, fetched once per page load (a constant key); a failure is evicted so a later focus refetches. */
const KEY = 'amenities'
const cache = createInteriorCache(() => loadAmenities(BASE_URL))

const LOADING: AmenitiesLoad = { state: 'loading' }
const ERROR: AmenitiesLoad = { state: 'error' }

function initialLoad(): AmenitiesLoad {
  const index = cache.peek(KEY)
  return index ? { state: 'ready', index } : LOADING
}

/**
 * The station amenities (public/data/stations/amenities.json: restrooms and customer service centers), fetched once
 * after mount, whether or not the Worker is configured (about 1 KB gzipped, outside the startup budget). A failure is
 * logged and shows as `error` until the focused station changes, which retries. Not aborted: it lands in the cache.
 */
export function useAmenities(stationId: string | null): AmenitiesLoad {
  const [load, setLoad] = useState<AmenitiesLoad>(initialLoad)

  useEffect(() => {
    if (load.state !== 'loading') return
    let cancelled = false
    cache.get(KEY).then(
      (index) => {
        if (!cancelled) setLoad({ state: 'ready', index })
      },
      (err: unknown) => {
        console.error('Failed to load the station amenities', err)
        if (!cancelled) setLoad(ERROR)
      },
    )
    return () => {
      cancelled = true
    }
  }, [load.state])

  // A failed load is requested again on the next focus change (the cache already evicted the failure).
  useEffect(() => {
    setLoad((l) => (l.state === 'error' ? LOADING : l))
  }, [stationId])

  return load
}
