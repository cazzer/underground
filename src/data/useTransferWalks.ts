import { useEffect, useState } from 'react'
import type { Network } from '../lib/network'
import { transferPairStations, transferStationIds } from '../lib/transferPairs'
import type { StationId } from './schema'
import { loadWalkGraph } from './useStationWalk'
import type { WalkGraph } from './walkSchema'

export interface TransferWalks {
  /** The loaded walk graphs by station id (a station with no file, or whose load failed, is absent). */
  graphs: ReadonlyMap<StationId, WalkGraph>
  /** Every load has settled, loaded or failed: until then a walk between stations must not draw (straight, then swapped). */
  settled: boolean
}

const NONE: TransferWalks = { graphs: new Map(), settled: false }

/**
 * The walk graphs of every station in a transfer between two complexes (transfers.json; today 5 stations, 3 pairs), so a
 * trip's walk between stations can follow the street network (85r). Loads once `enabled` (the trip panel open with a
 * ready plan, which only happens with `FEATURES.navigation`), never at startup.
 *
 * Privacy: a shard request names its station to the static host. The set is fixed by the static data alone, never by
 * the journey, so which of these a rider walks between stays unknown, as for the trip's transfer interiors
 * (`useTripTransfers`); it is never keyed by the location fix or the nearest station. A failed load is logged and
 * left out, and that walk stays straight.
 */
export function useTransferWalks(network: Network, enabled: boolean): TransferWalks {
  const [state, setState] = useState<TransferWalks>(NONE)
  useEffect(() => {
    if (!enabled || state.settled) return
    let current = true
    const leadOf = new Map(network.stations.map((s) => [s.id, s.leadId]))
    const settle = (graphs: Map<StationId, WalkGraph>): void => {
      if (current) setState({ graphs, settled: true })
    }
    import('./loadTimetable')
      .then((m) => m.transfersFile())
      .then((file) => {
        const ids = transferStationIds(transferPairStations(file.transfers, (id) => leadOf.get(id) ?? id))
        return Promise.all(
          ids.map((id) =>
            loadWalkGraph(id).then(
              (graph) => [id, graph] as const,
              (err: unknown) => {
                console.error(`Transfer walks: no walk graph for station ${id} (${err instanceof Error ? err.message : String(err)}); its walks draw straight`)
                return [id, null] as const
              },
            ),
          ),
        )
      })
      .then(
        (entries) => settle(new Map(entries.flatMap(([id, graph]) => (graph ? [[id, graph] as const] : [])))),
        (err: unknown) => {
          console.error(`Transfer walks: no transfers (${err instanceof Error ? err.message : String(err)}); walks draw straight`)
          settle(new Map())
        },
      )
    return () => {
      current = false
    }
  }, [enabled, state.settled, network])
  return state
}
