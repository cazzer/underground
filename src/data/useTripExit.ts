import { useEffect, useMemo, useState } from 'react'
import { chooseExit, quickestExit, type ExitChoice, type ExitResult } from '../lib/exitChoice'
import { exitLineView, finalRideStops, type ExitLabel, type ExitLineView, type StreetSource } from '../lib/exitView'
import { stationOfStop } from '../lib/live/arrivals'
import { joinStationOutages, type EneInput } from '../lib/live/eneJoin'
import type { Ground } from '../lib/projection'
import { plannable, tripKey, type TripEnds, type TripPlanState } from '../lib/tripView'
import { interiorIdOf, type IndexLoad } from './interiorLoad'
import { useInteriorModel } from './useStationInterior'
import { useStationStreetsLoad, type StreetLayer } from './useStationStreets'
import { useStationWalk } from './useStationWalk'

interface TripExitInput {
  /** The trip panel is open (covered by a train panel or not). */
  open: boolean
  ends: TripEnds
  plan: TripPlanState
  index: IndexLoad
  ene: EneInput
  nowS: number
}

export interface TripExit {
  /** The To station's interior file id: the path draws only while that interior is the focused one. */
  interiorId: string
  /** The way out the map draws: the first journey's that ends on a train; null when it has none. */
  drawn: ExitChoice | null
  /** The street label naming the drawn exit, which the map's street labels place first and tint. */
  mapLabel: ExitLabel | null
  /** The trip panel's exit line, by the trip id of a journey's last ride. */
  lines: ReadonlyMap<string, ExitLineView>
}

/** A route search over interior data: a data error is logged and means no exit line, never a crashed HUD. */
function safely(stopId: string, run: () => ExitResult): ExitChoice | null {
  try {
    const r = run()
    return r.kind === 'exit' ? r : null
  } catch (err) {
    console.error(`Couldn't find the way out at ${stopId}`, err)
    return null
  }
}

const isLayer = (l: StreetLayer | null | undefined): l is StreetLayer => l !== null && l !== undefined

/**
 * The quickest way out at the trip's To station, for the map and the trip panel: once a plan for the panel's ends is
 * ready, the To station's interior and street files load (the visitor chose that station) and every journey ending on a
 * train gets its exit line. Out-of-service machines are avoided; with no fresh outage data nothing counts as closed, and
 * a line that rides a machine says its status is unknown when the station panel would. A complex reads its file id's
 * street file and the alighting member's; the result waits until both settle, so a line never turns from a compass
 * way into a street name. Rebuilt only when what it reads changes (string keys), so the 30 s refresh and live polls
 * keep the same choice object and the drawn path's buffers.
 *
 * DEV only: `__underground.exitTo(x, z)` aims the drawn exit at a scene point (its station's walk graph then loads),
 * `exitTo(null)` clears it (`exitTo(x)` alone warns and does nothing). Production never fetches a walk graph here.
 * Remove when 2q7.14 supplies the point.
 */
export function useTripExit({ open, ends, plan, index, ene, nowS }: TripExitInput): TripExit | null {
  const ready = open && plannable(ends) && plan.status === 'ready' && plan.key === tripKey(ends.from, ends.to)
  const stops = ready && plan.status === 'ready' ? finalRideStops(plan.journeys) : []
  const stationId = stops[0] ? stationOfStop(stops[0].stopId) : null
  const interiorId = interiorIdOf(stationId, index)
  // Only the stops the To interior covers (a complex covers every member's).
  const served = stops.filter((s) => interiorIdOf(stationOfStop(s.stopId), index) === interiorId)
  const servedKey = served.map((s) => `${s.stopId}=${s.tripIds.join('|')}`).join(',')
  const model = useInteriorModel(interiorId)
  const fileStreets = useStationStreetsLoad(interiorId)
  // Nearly redundant since 2q7.32: every member's street file carries its complex's entrances (minus shared elevators
  // and far ones; a lead's file, which the covering file is, keeps the members' elevators), so the covering file alone usually has the exit; this second read of the member's own file stays as the fallback.
  const memberStreets = useStationStreetsLoad(interiorId && stationId !== interiorId ? stationId : null)
  const settled = fileStreets.settled && memberStreets.settled
  const [target, setTarget] = useState<Ground | null>(null)
  const walk = useStationWalk(import.meta.env.DEV && target && interiorId ? stationId : null)
  const outages = joinStationOutages(model?.interior ?? null, ene, nowS)
  const outKey = outages.outIds.join(',')
  // As the station panel: still connecting says nothing; only stale, failed or mismatched data is "unknown".
  const known = outages.panel.kind !== 'unknown'

  useEffect(() => {
    if (!import.meta.env.DEV) return
    const exitTo = (x: number | null, z?: number): void => {
      if (x === null) return setTarget(null)
      if (z === undefined) return console.warn('exitTo needs a scene x and z (or null to clear); nothing changed')
      setTarget({ x, z })
    }
    window.__underground = { ...window.__underground, exitTo }
    return () => {
      if (window.__underground) delete window.__underground.exitTo
    }
  }, [])

  const first = fileStreets.layer ?? memberStreets.layer
  const second = fileStreets.layer ? memberStreets.layer : null
  // The choices hang on the stops alone: a poll that swaps a train for its live twin keeps them, and the drawn path.
  const stopIdsKey = served.map((s) => s.stopId).join(',')
  const choices = useMemo(() => {
    const out = new Map<string, ExitChoice | null>()
    if (!model || !settled) return out
    const interior = model.interior
    const closed = new Set(outKey === '' ? [] : outKey.split(','))
    const file = first?.file ?? null
    served.forEach(({ stopId }, i) => {
      const toPoint = i === 0 && target !== null
      out.set(
        stopId,
        safely(stopId, () =>
          toPoint ? chooseExit({ interior, stopId, destination: target, walk, streets: file, closed }) : quickestExit({ interior, stopId, streets: file, closed }),
        ),
      )
    })
    return out
    // `served` is read through stopIdsKey.
  }, [stopIdsKey, model, settled, first, outKey, target, walk])

  return useMemo(() => {
    if (!model || !interiorId || served.length === 0 || !settled) return null
    const sources: StreetSource[] = [first, second].filter(isLayer).map((l) => ({ file: l.file, labels: l.entrances }))
    const lines = new Map<string, ExitLineView>()
    let mapLabel: ExitLabel | null = null
    served.forEach((stop, i) => {
      const choice = choices.get(stop.stopId)
      if (!choice) return
      const view = exitLineView(choice, model.interior, sources, known)
      if (i === 0) mapLabel = view.mapLabel
      for (const id of stop.tripIds) lines.set(id, view)
    })
    return { interiorId, drawn: choices.get(served[0]!.stopId) ?? null, mapLabel, lines }
    // `served` is read through servedKey: a refresh with the same stops and trips keeps the result.
  }, [servedKey, interiorId, model, settled, first, second, choices, known])
}
