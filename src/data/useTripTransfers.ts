import { useMemo } from 'react'
import type { StationInterior } from './stationSchema'
import type { StationPathDraw } from '../lib/interiorPath'
import { chooseTransfer, type TransferChoice } from '../lib/interiorTransfer'
import { stationOfStop } from '../lib/live/arrivals'
import { joinStationOutages, type EneInput } from '../lib/live/eneJoin'
import { journeyTransferDraws, transferLegs, transferLineView, type TransferLeg, type TransferLineView } from '../lib/transferView'
import type { TripJourney } from '../lib/route/plan'
import { plannable, tripKey, type TripEnds, type TripNames, type TripPlanState } from '../lib/tripView'
import { authoredInteriorIds, interiorIdOf, type IndexLoad } from './interiorLoad'
import { useInteriorModels } from './useStationInterior'

interface TripTransfersInput {
  /** The trip panel is open (covered by a train panel or not). */
  open: boolean
  ends: TripEnds
  plan: TripPlanState
  index: IndexLoad
  ene: EneInput
  nowS: number
  names: TripNames
  /** The journey the map draws a change for: the opened one, else the first. */
  selected: TripJourney | null
}

export interface TripTransfers {
  /** At most one transfer path per interior: the selected journey's change there, none when it takes no connector. */
  drawn: StationPathDraw[]
  /** The trip panel's transfer line, by `transferLegKey`. */
  lines: ReadonlyMap<string, TransferLineView>
}

/** A route search over interior data: a data error is logged and means no transfer line, never a crashed HUD. */
function safely(interior: StationInterior, fromStop: string, toStop: string, closed: ReadonlySet<string>): TransferChoice | null {
  try {
    const r = chooseTransfer({ interior, fromStop, toStop, closed })
    return r.kind === 'transfer' ? r : null
  } catch (err) {
    console.error(`Couldn't find the transfer from ${fromStop} to ${toStop}`, err)
    return null
  }
}

const NONE: TripTransfers = { drawn: [], lines: new Map() }

/**
 * The transfers inside hand-authored complexes, for the map and the trip panel: once a plan for the panel's ends is
 * ready, every hand-authored interior in the index loads (all of them, so the requests don't say which station the trip
 * changes at), and each change whose two stops are in one of them gets its transfer line. Generated interiors are left
 * out: their layouts can't carry a transfer. Out-of-service machines are avoided as for the exit; the choices are
 * rebuilt only when the stops, a model or the machines out change (string keys), so refreshes keep the drawn paths.
 * Every journey's changes get a line; only the selected journey's change is drawn.
 */
export function useTripTransfers({ open, ends, plan, index, ene, nowS, names, selected }: TripTransfersInput): TripTransfers {
  const ready = open && plannable(ends) && plan.status === 'ready' && plan.key === tripKey(ends.from, ends.to)
  const legs = ready && plan.status === 'ready' ? transferLegs(plan.journeys, names.station) : []
  const authoredKey = ready ? authoredInteriorIds(index).join(',') : ''
  const models = useInteriorModels(useMemo(() => (authoredKey === '' ? [] : authoredKey.split(',')), [authoredKey]))
  const fileOf = (stop: string): string | null => interiorIdOf(stationOfStop(stop), index)
  const kept: (TransferLeg & { file: string })[] = []
  for (const leg of legs) {
    const file = fileOf(leg.fromStop)
    if (file !== null && file === fileOf(leg.toStop) && models.has(file)) kept.push({ ...leg, file })
  }
  const drawKey = transferLegs(ready && selected ? [selected] : [], names.station)
    .map((l) => l.key)
    .join(',')
  const keptKey = kept.map((l) => `${l.file}:${l.key}`).join(',')
  // Per interior, the machines out and whether that is known, as the station panel would say it.
  const outages = [...new Set(kept.map((l) => l.file))].map((file) => {
    const o = joinStationOutages(models.get(file)!.interior, ene, nowS)
    return { file, out: o.outIds.join('|'), known: o.panel.kind !== 'unknown' }
  })
  const outKey = outages.map((o) => `${o.file}=${o.out}`).join(',')
  const knownKey = outages.map((o) => `${o.file}=${o.known}`).join(',')

  // One search per distinct stop pair (the next route only changes the wording).
  const choices = useMemo(() => {
    const out = new Map<string, TransferChoice | null>()
    const closedOf = new Map<string, ReadonlySet<string>>()
    for (const entry of outKey === '' ? [] : outKey.split(',')) {
      const [file, ids] = entry.split('=') as [string, string]
      closedOf.set(file, new Set(ids === '' ? [] : ids.split('|')))
    }
    for (const leg of kept) {
      const pair = `${leg.fromStop}>${leg.toStop}`
      if (out.has(pair)) continue
      out.set(pair, safely(models.get(leg.file)!.interior, leg.fromStop, leg.toStop, closedOf.get(leg.file) ?? new Set()))
    }
    return out
    // `kept` is read through keptKey.
  }, [keptKey, models, outKey])

  return useMemo(() => {
    if (kept.length === 0) return NONE
    const known = new Map(knownKey.split(',').map((e) => e.split('=') as [string, string]))
    const lines = new Map<string, TransferLineView>()
    for (const leg of kept) {
      const choice = choices.get(`${leg.fromStop}>${leg.toStop}`)
      if (!choice) continue
      const interior = models.get(leg.file)!.interior
      try {
        lines.set(leg.key, transferLineView(choice, interior, names.route(leg.nextRouteId), known.get(leg.file) === 'true'))
      } catch (err) {
        console.error(`Couldn't describe the transfer from ${leg.fromStop} to ${leg.toStop}`, err)
      }
    }
    const drawn = journeyTransferDraws(kept, new Set(drawKey === '' ? [] : drawKey.split(',')), (leg) => choices.get(`${leg.fromStop}>${leg.toStop}`) ?? null)
    return { drawn, lines }
    // `kept` is read through keptKey.
  }, [keptKey, choices, models, knownKey, names, drawKey])
}
