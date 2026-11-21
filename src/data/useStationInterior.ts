import { useCallback, useEffect, useState } from 'react'
import { buildInteriorModel } from '../scene/interiorModel'
import { createInteriorCache } from './interiorCache'
import { deriveInteriorLoad, type InteriorLoad, type SettledLoad } from './interiorLoad'
import { hasInterior } from './interiorRegistry'
import { loadStationInterior } from './loadStationInterior'
import { withDemoMachines } from './machineDemo'

export type { InteriorLoad } from './interiorLoad'

/**
 * One fetch per station per page load. The model is built inside the promise, so a data error
 * becomes an `error` load rather than a render crash; failures are evicted so Retry refetches.
 */
const cache = createInteriorCache((id) =>
  loadStationInterior(import.meta.env.BASE_URL, id)
    // TEMPORARY (machineLook.ts): dev-only demo escalators and elevators for the 9wc.8 look card.
    .then((i) => (import.meta.env.DEV && new URLSearchParams(window.location.search).has('machinesDemo') ? withDemoMachines(i) : i))
    .then(buildInteriorModel),
)

/** Interior for the focused station; stations without an interior file never fetch. */
export function useStationInterior(stationId: string | null): { load: InteriorLoad; retry: () => void } {
  const id = stationId && hasInterior(stationId) ? stationId : null
  const [settled, setSettled] = useState<SettledLoad | null>(null)
  const [attempt, setAttempt] = useState(0)

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

  return { load: deriveInteriorLoad(id, cache.peek, settled), retry }
}
