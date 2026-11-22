import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildInteriorModel, type InteriorModel } from '../scene/interiorModel'
import { createInteriorCache } from './interiorCache'
import { deriveInteriorLoad, focusedMarkerShown, interiorIdOf, modelsToLoad, NO_SIBLINGS, siblingIdsOf, type IndexLoad, type InteriorLoad, type SettledLoad } from './interiorLoad'
import { loadStationIndex } from './loadStationIndex'
import { loadStationInterior } from './loadStationInterior'

export type { InteriorLoad } from './interiorLoad'

const BASE_URL = import.meta.env.BASE_URL

/**
 * One fetch per station per page load. The model is built inside the promise, so a data error
 * becomes an `error` load rather than a render crash; failures are evicted so Retry refetches.
 */
const cache = createInteriorCache((id) =>
  loadStationInterior(BASE_URL, id)
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
 * `retry` retries a failed interior. `streetMarker`: whether the scene draws the focused station's own marker.
 */
export function useStationInterior(
  stationId: string | null,
): { load: InteriorLoad; retry: () => void; streetMarker: boolean; siblings: readonly string[]; index: IndexLoad } {
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

  const load = deriveInteriorLoad(stationId, indexLoad, cache.peek, settled)
  const streetMarker = focusedMarkerShown(stationId, indexLoad, load)
  // The focused station's complex siblings, whose markers and ties the scene hides with its own. None while the
  // station keeps its street marker (no interior, or a failed load): there is nothing to stand in for them.
  const indexed = useMemo(() => siblingIdsOf(stationId, indexLoad), [stationId, indexLoad])
  const siblings = streetMarker ? NO_SIBLINGS : indexed
  // Whether the focused station keeps its street marker and tie (the no-interior fallback; see focusedMarkerShown).
  return { load, retry, streetMarker, siblings, index: indexLoad }
}

/**
 * A station interior's model by file id (`interiorIdOf`), from the same cache as the focused interior, so it is the
 * same object once that station is focused. Null while loading, with no id, or after a failure (logged). Fetches only
 * an id the visitor chose (a trip's To station), like the focused one.
 */
export function useInteriorModel(id: string | null): InteriorModel | null {
  // The last id whose load settled: set only to re-render once the cache holds it.
  const [, setLoadedId] = useState<string | null>(null)
  useEffect(() => {
    if (!id || cache.peek(id)) return
    let cancelled = false
    cache.get(id).then(
      () => {
        if (!cancelled) setLoadedId(id)
      },
      (err: unknown) => console.error(`Failed to load the interior of station ${id}`, err),
    )
    return () => {
      cancelled = true
    }
  }, [id])
  return (id && cache.peek(id)) || null
}

const NO_MODELS: ReadonlyMap<string, InteriorModel> = new Map()

/**
 * Several interiors' models by file id, from the same cache: those loaded so far (a failure is logged and left out).
 * The map is built from the ids loaded at render (`loadedKey`) and keeps its identity until that changes. A load that
 * settles between a render and its effect is caught by the effect (`modelsToLoad`'s `stale`), which re-renders.
 */
export function useInteriorModels(ids: readonly string[]): ReadonlyMap<string, InteriorModel> {
  const key = ids.join(',')
  const loadedKey = ids.filter((id) => cache.peek(id)).join(',')
  const [, setSettled] = useState(0)
  useEffect(() => {
    let cancelled = false
    const bump = (): void => {
      if (!cancelled) setSettled((n) => n + 1)
    }
    const { fetch, stale } = modelsToLoad(key === '' ? [] : key.split(','), (id) => cache.peek(id) !== undefined, loadedKey)
    if (stale) bump()
    for (const id of fetch) cache.get(id).then(bump, (err: unknown) => console.error(`Failed to load the interior of station ${id}`, err))
    return () => {
      cancelled = true
    }
  }, [key, loadedKey])
  return useMemo(() => {
    if (loadedKey === '') return NO_MODELS
    return new Map(loadedKey.split(',').map((id) => [id, cache.peek(id)!]))
  }, [loadedKey])
}
