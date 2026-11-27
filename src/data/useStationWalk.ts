import { useEffect, useState } from 'react'
import { createInteriorCache } from './interiorCache'
import { decodeStationWalk, loadStationWalk } from './loadStationWalk'
import type { StationId, Transfer } from './schema'
import { transferPairStations, transferStationIds } from '../lib/transferPairs'
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
 * it runs and why that is allowed; everything else goes through `useStationWalk`.
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
  /** The station's walk graph once loaded; null while loading, with no walk file, after a failure (logged) or with no station. */
  graph: WalkGraph | null
  /** The load has resolved, failed or run past `WALK_DEADLINE_MS` (or there is no station): what is drawn from it may be decided. */
  settled: boolean
}

/** A hung shard stops holding a drawing back after this long: it then draws without the graph (a late graph still joins). */
export const WALK_DEADLINE_MS = 3000

/**
 * A station's walk graph, loaded through the shared cache, nothing fetched until
 * `stationId` is set. `settled` is true once the load has resolved, failed (logged; the next time the station is asked
 * for, it is retried) or run past `WALK_DEADLINE_MS`, so a drawing that depends on it can wait for the answer instead of
 * drawing straight and swapping.
 *
 * Privacy: the request reveals the station id to the static host, so pass only a station the user picked, focused, or
 * chose as a trip endpoint, or the station a journey reaches that end at (a6m: the walk between a searched place and
 * its end), never the station nearest a location fix without a user action. The one other caller is
 * `loadTransferWalkGraphs` above (85r). See loadStationWalk.ts.
 */
export function useStationWalkLoad(stationId: string | null): WalkLoad {
  // The last station whose load settled, or whose deadline passed: set only to re-render.
  const [settledId, setSettledId] = useState<string | null>(null)

  useEffect(() => {
    if (!stationId || cache.peek(stationId) !== undefined) return
    let current = true
    // A retry after a failure starts unsettled again.
    setSettledId(null)
    const settle = (): void => {
      if (current) setSettledId(stationId)
    }
    const timer = setTimeout(() => {
      console.warn(`Walk graph of station ${stationId} still loading after ${WALK_DEADLINE_MS} ms; its walk draws without it`)
      settle()
    }, WALK_DEADLINE_MS)
    cache.get(stationId).then(
      () => {
        clearTimeout(timer)
        settle()
      },
      (err: unknown) => {
        clearTimeout(timer)
        console.error(`Failed to load the walk graph of station ${stationId}`, err)
        settle()
      },
    )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [stationId])

  if (!stationId) return { graph: null, settled: true }
  const graph = cache.peek(stationId) ?? null
  return { graph, settled: graph !== null || settledId === stationId || cache.peek(stationId) === null }
}
