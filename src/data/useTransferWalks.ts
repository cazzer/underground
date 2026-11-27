import { useEffect, useRef, useState } from 'react'
import type { Network } from '../lib/network'
import type { StationId } from './schema'
import { loadTransferWalkGraphs } from './useStationWalk'
import type { WalkGraph } from './walkSchema'

export interface TransferWalks {
  /** The loaded walk graphs by station id (a station with no file, or whose load failed or is late, is absent). */
  graphs: ReadonlyMap<StationId, WalkGraph>
  /** Every load has settled or the deadline passed: until then a walk between stations must not draw (straight, then swapped). */
  settled: boolean
  /** A load was rejected: the next time the trip closes, the set is asked for again. */
  failed: boolean
}

const NONE: TransferWalks = { graphs: new Map(), settled: false, failed: false }

/** After this long a hung shard no longer holds the route back: the walks without a graph draw straight. */
export const WALK_DEADLINE_MS = 3000

/**
 * The walk graphs of every station in a transfer between two complexes (transfers.json; a handful, 5 stations today), so
 * a trip's walk between stations can follow the street network (85r). Loads once `enabled` (the trip panel open with a
 * ready plan, which only happens with `FEATURES.navigation`), never at startup.
 *
 * Privacy: a shard request names its station to the static host. The set is fixed by the static data alone: the same
 * for every plan, whatever the ends (an end filled from the location fix included, which still fetches nothing of its
 * own) and never keyed by the fix or the nearest station, so which of these a rider walks between stays unknown, as
 * for the trip's transfer interiors (`useTripTransfers`). `loadTransferWalkGraphs` takes no station id.
 *
 * Settles when every load has, or after `WALK_DEADLINE_MS` with what has loaded (a late shard then joins). A rejected
 * load is logged and left out, its walk straight; closing the trip then forgets the result, so the next plan retries.
 */
export function useTransferWalks(network: Network, enabled: boolean): TransferWalks {
  const [state, setState] = useState<TransferWalks>(NONE)
  // Read by the effect, which must not re-run (and cancel a late shard's publish) when its own result lands.
  const latest = useRef(state)
  latest.current = state
  useEffect(() => {
    if (!enabled) {
      if (latest.current.failed) setState(NONE)
      return
    }
    if (latest.current.settled) return
    let current = true
    let settled = false
    let failed = false
    const found = new Map<StationId, WalkGraph>()
    const publish = (): void => {
      if (current) setState({ graphs: new Map(found), settled: true, failed })
    }
    const settle = (): void => {
      settled = true
      publish()
    }
    const timer = setTimeout(() => {
      if (settled) return
      console.warn(`Transfer walks: walk graphs still loading after ${WALK_DEADLINE_MS} ms; walks without one draw straight`)
      settle()
    }, WALK_DEADLINE_MS)
    const leadOf = new Map(network.stations.map((s) => [s.id, s.leadId]))
    import('./loadTimetable')
      .then((m) => m.transfersFile())
      .then((file) =>
        loadTransferWalkGraphs(file.transfers, (id) => leadOf.get(id) ?? id, {
          loaded: (id, graph) => {
            if (!graph) return
            found.set(id, graph)
            if (settled) publish()
          },
          failed: (id, err) => {
            failed = true
            if (settled) publish()
            console.error(`Transfer walks: no walk graph for station ${id} (${err instanceof Error ? err.message : String(err)}); its walks draw straight`)
          },
        }),
      )
      .then(
        () => {
          clearTimeout(timer)
          settle()
        },
        (err: unknown) => {
          clearTimeout(timer)
          failed = true
          console.error(`Transfer walks: no transfers (${err instanceof Error ? err.message : String(err)}); walks draw straight`)
          settle()
        },
      )
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [enabled, network])
  return state
}
