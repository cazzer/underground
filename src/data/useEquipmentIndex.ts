import { useEffect, useState } from 'react'
import type { EquipmentLoad } from '../lib/live/eneIndexJoin'
import { createInteriorCache } from './interiorCache'
import { loadEquipmentIndex } from './loadEquipmentIndex'

const BASE_URL = import.meta.env.BASE_URL

/** The equipment index, fetched once per page load (a constant key); a failure is evicted so a later focus refetches. */
const KEY = 'equipment'
const cache = createInteriorCache(() => loadEquipmentIndex(BASE_URL))

const IDLE: EquipmentLoad = { status: 'idle' }
const LOADING: EquipmentLoad = { status: 'loading' }

function initialLoad(): EquipmentLoad {
  const index = cache.peek(KEY)
  return index ? { status: 'ready', index } : IDLE
}

/**
 * The equipment index (public/data/stations/equipment.json, the machines the station panel can name beyond the
 * focused interior's), fetched on the first focus of a station and only while `enabled` (the outage feed is
 * configured): never at startup. It reads as `loading` from the first render that wants it, so a view built from it
 * never sees an `idle` gap. Once loaded it stays; a failure (logged) shows as `error` until the focus changes,
 * which retries. Not aborted: a small file may as well finish and land in the cache.
 */
export function useEquipmentIndex(stationId: string | null, enabled: boolean): EquipmentLoad {
  const [state, setState] = useState<EquipmentLoad>(initialLoad)
  const want = enabled && stationId !== null

  useEffect(() => {
    if (!want || state.status !== 'idle') return
    let cancelled = false
    cache.get(KEY).then(
      (index) => {
        if (!cancelled) setState({ status: 'ready', index })
      },
      (err: unknown) => {
        console.error('Failed to load the equipment index', err)
        if (!cancelled) setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [want, state.status])

  // A failed load is requested again on the next focus change (the cache already evicted the failure).
  useEffect(() => {
    setState((s) => (s.status === 'error' ? IDLE : s))
  }, [stationId])

  return state.status === 'idle' && want ? LOADING : state
}
