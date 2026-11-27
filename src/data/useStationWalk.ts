import { useEffect, useMemo, useRef, useState } from 'react'
import { stationOfStop } from '../lib/live/arrivals'
import { transferPairStations, transferStationIds } from '../lib/transferPairs'
import { createInteriorCache } from './interiorCache'
import { decodeStationWalk, loadStationWalk } from './loadStationWalk'
import type { StationId, Transfer } from './schema'
import type { WalkGraph } from './walkSchema'

const BASE_URL = import.meta.env.BASE_URL

/**
 * One fetch per station per page load, decoded inside the promise so a data error rejects (and is evicted, so the
 * next use retries). A station with no walk file resolves to null, which stays cached.
 */
const cache = createInteriorCache((id) => loadStationWalk(BASE_URL, id).then((file) => file && decodeStationWalk(file)))

export interface TransferWalkLoad {
  /** A shard settled (null: the station has no walk file). */
  loaded(id: StationId, graph: WalkGraph | null): void
  /** A shard's load failed (evicted from the cache, so the next call retries it). */
  failed(id: StationId, err: unknown): void
}

/**
 * Loads the walk graphs of the fixed set of stations in a transfer between two complexes (85r), through the shared
 * cache; resolves once every load has settled. The set comes from the transfers file and the complexes alone: this
 * takes no station id, so the journey, the ends and the location fix cannot key it. See `useTransferWalks` for when
 * it runs and why that is allowed; everything else goes through `useStationWalkLoads`.
 */
export function loadTransferWalkGraphs(
  transfers: readonly Pick<Transfer, 'from' | 'to'>[],
  leadOf: (id: StationId) => StationId,
  on: TransferWalkLoad,
): Promise<void> {
  const ids = transferStationIds(transferPairStations(transfers, leadOf))
  return Promise.all(ids.map((id) => cache.get(id).then((graph) => on.loaded(id, graph), (err: unknown) => on.failed(id, err)))).then(() => undefined)
}

export interface WalkLoad {
  /** The station's walk graph once loaded; null while loading, with no walk file, after a failure (logged) or when it came after `WALK_DEADLINE_MS`. */
  graph: WalkGraph | null
  /** The load has resolved, failed or run past `WALK_DEADLINE_MS`: what is drawn from it may be decided. */
  settled: boolean
}

/** A hung shard stops holding a drawing back after this long: it then draws without the graph. */
export const WALK_DEADLINE_MS = 3000

const PENDING: WalkLoad = { graph: null, settled: false }
const WITHOUT: WalkLoad = { graph: null, settled: true }

/** How a load ended before it was in the cache for the render: it resolved (the cache holds it), failed, or ran past the deadline. */
type Ended = 'loaded' | 'failed' | 'late'

/**
 * The walk graphs of `stationIds`, loaded through the shared cache; nothing is fetched for an empty list. Each entry is
 * `settled` once its load has resolved, failed (logged; the next time the station is asked for it is retried) or run
 * past `WALK_DEADLINE_MS`, so a drawing that depends on it waits for the answer instead of drawing straight and
 * swapping. A load that misses the deadline is frozen: a graph that arrives later is ignored while the station stays in
 * the list, so a walk or exit already drawn without it never changes under the visitor. Asking again after the station
 * left the list (the trip closed, other ends) takes whatever the cache holds.
 *
 * Privacy: the requests reveal the station ids to the static host, so pass only stations the user picked, focused or
 * chose as a trip endpoint, or (a6m) the stations of the end's own complex that the trip's journeys reach that end
 * at, for an end set from a place the visitor searched; never the station nearest a location fix without a user
 * action. The one other caller is `loadTransferWalkGraphs` above (85r). See loadStationWalk.ts.
 */
export function useStationWalkLoads(stationIds: readonly StationId[]): ReadonlyMap<StationId, WalkLoad> {
  const key = [...stationIds].sort().join(',')
  const [ended, setEnded] = useState<ReadonlyMap<StationId, Ended>>(() => new Map())
  // Read by the effect, which must not start a station's load again when only another id joined the list.
  const endedRef = useRef(ended)
  endedRef.current = ended

  useEffect(() => {
    const ids = key === '' ? [] : key.split(',')
    let current = true
    // Forget the endings of stations no longer asked for, so asking again starts clean.
    setEnded((prev) => (prev.size === 0 || [...prev.keys()].every((id) => ids.includes(id)) ? prev : new Map([...prev].filter(([id]) => ids.includes(id)))))
    // The first ending stands: a graph that resolves after the deadline does not replace 'late'.
    const end = (id: StationId, how: Ended): void => {
      if (current) setEnded((prev) => (prev.has(id) ? prev : new Map(prev).set(id, how)))
    }
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const id of ids) {
      // Loaded, or already ended (failed or late) while it stayed in the list: no second timer, warning or fetch.
      if (cache.peek(id) !== undefined || endedRef.current.has(id)) continue
      const timer = setTimeout(() => {
        console.warn(`Walk graph of station ${id} still loading after ${WALK_DEADLINE_MS} ms; its walk draws without it`)
        end(id, 'late')
      }, WALK_DEADLINE_MS)
      timers.push(timer)
      cache.get(id).then(
        () => {
          clearTimeout(timer)
          end(id, 'loaded')
        },
        (err: unknown) => {
          clearTimeout(timer)
          console.error(`Failed to load the walk graph of station ${id}`, err)
          end(id, 'failed')
        },
      )
    }
    return () => {
      current = false
      timers.forEach(clearTimeout)
    }
  }, [key])

  return useMemo(() => {
    const out = new Map<StationId, WalkLoad>()
    for (const id of key === '' ? [] : key.split(',')) {
      const how = ended.get(id)
      const peeked = cache.peek(id)
      out.set(id, how === 'late' || how === 'failed' ? WITHOUT : peeked !== undefined ? { graph: peeked, settled: true } : PENDING)
    }
    return out
  }, [key, ended])
}

/** The load of the station a stop stands at, from `useStationWalkLoads`; null with no map, or for a station it was not asked about. */
export function walkLoadAt(loads: ReadonlyMap<StationId, WalkLoad> | null, stopId: string): WalkLoad | null {
  return loads?.get(stationOfStop(stopId)) ?? null
}
