import { useCallback, useEffect, useState } from 'react'
import { buildInteriorModel } from '../scene/interiorModel'
import { createInteriorCache } from './interiorCache'
import { deriveInteriorLoad, interiorIdOf, type IndexLoad, type InteriorLoad, type SettledLoad } from './interiorLoad'
import { loadStationIndex } from './loadStationIndex'
import { loadStationInterior } from './loadStationInterior'
import { withDemoMachines } from './machineDemo'

export type { InteriorLoad } from './interiorLoad'

const BASE_URL = import.meta.env.BASE_URL

/**
 * One fetch per station per page load. The model is built inside the promise, so a data error
 * becomes an `error` load rather than a render crash; failures are evicted so Retry refetches.
 */
const cache = createInteriorCache((id) =>
  loadStationInterior(BASE_URL, id)
    // TEMPORARY (machineLook.ts): dev-only demo escalators and elevators for the 9wc.8 look card.
    .then((i) => (import.meta.env.DEV && new URLSearchParams(window.location.search).has('machinesDemo') ? withDemoMachines(i) : i))
    .then(buildInteriorModel),
)

/** The station index, fetched once per page load (a constant key); a failure is evicted so Retry refetches. */
const INDEX_KEY = 'index'
const indexCache = createInteriorCache(() => loadStationIndex(BASE_URL))

const INDEX_LOADING: IndexLoad = { status: 'loading' }

function initialIndexLoad(): IndexLoad {
  const index = indexCache.peek(INDEX_KEY)
  return index ? { status: 'ready', index } : INDEX_LOADING
}

/**
 * Interior for the focused station; stations the index doesn't list never fetch. The index is fetched on
 * mount (no waiting for a first focus); while it loads or after it fails, no station shows an interior panel.
 * `retry` retries a failed interior.
 */
export function useStationInterior(stationId: string | null): { load: InteriorLoad; retry: () => void } {
  const [indexLoad, setIndexLoad] = useState<IndexLoad>(initialIndexLoad)
  const [settled, setSettled] = useState<SettledLoad | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [indexAttempt, setIndexAttempt] = useState(0)
  const id = interiorIdOf(stationId, indexLoad)

  useEffect(() => {
    if (indexCache.peek(INDEX_KEY)) return
    let cancelled = false
    indexCache.get(INDEX_KEY).then(
      (index) => {
        if (!cancelled) setIndexLoad({ status: 'ready', index })
      },
      (err: unknown) => {
        console.error('Failed to load the station index', err)
        if (!cancelled) setIndexLoad({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [indexAttempt])

  // A failed index is requested again on the next focus change (the cache already evicted the failure).
  useEffect(() => {
    if (indexLoad.status !== 'error') return
    setIndexLoad(INDEX_LOADING)
    setIndexAttempt((n) => n + 1)
    // Only a focus change retries; `indexLoad` is read, not a trigger.
  }, [stationId])

  useEffect(() => {
    if (!id || cache.peek(id)) return
    let cancelled = false
    // Not aborted on unmount or refocus: a small file may as well finish and land in the cache.
    cache.get(id).then(
      (model) => {
        if (!cancelled) setSettled({ id, load: { status: 'ready', model } })
      },
      (err: unknown) => {
        console.error(`Failed to load the interior of station ${id}`, err)
        if (!cancelled) setSettled({ id, load: { status: 'error', message: err instanceof Error ? err.message : String(err) } })
      },
    )
    return () => {
      cancelled = true
      // A later focus of the same station shows loading, not this attempt's stale error.
      setSettled(null)
    }
  }, [id, attempt])

  const retry = useCallback(() => {
    setSettled(null)
    setAttempt((n) => n + 1)
  }, [])

  return { load: deriveInteriorLoad(stationId, indexLoad, cache.peek, settled), retry }
}
