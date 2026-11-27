import { useMemo } from 'react'
import type { StationId } from './schema'
import { chooseExit, quickestExit, type ExitChoice, type ExitResult } from '../lib/exitChoice'
import { drawnExitStop, exitLineView, finalRideStops, type ExitLabel, type ExitLineView, type StreetSource } from '../lib/exitView'
import { stationOfStop } from '../lib/live/arrivals'
import { joinStationOutages, type EneInput } from '../lib/live/eneJoin'
import { toGround, type Ground } from '../lib/projection'
import type { TripJourney } from '../lib/route/plan'
import { selectedFirst } from '../lib/tripSelection'
import { plannable, tripKey, type TripEnds, type TripPlanState } from '../lib/tripView'
import { interiorIdOf, type IndexLoad } from './interiorLoad'
import { useInteriorModel } from './useStationInterior'
import { useStationStreetsLoad, type StreetLayer } from './useStationStreets'
import { walkLoadAt, type WalkLoad } from './useStationWalk'

interface TripExitInput {
  /** The trip panel is open (covered by a train panel or not). */
  open: boolean
  ends: TripEnds
  plan: TripPlanState
  index: IndexLoad
  ene: EneInput
  nowS: number
  /** The journey the map draws the way out of: the opened one, else the first. */
  selected: TripJourney | null
  /** The visitor chose the To station (it was not filled from a location fix, or they have since picked or focused
   *  it, `fixEnd`): only then are its files fetched. */
  allowed: boolean
  /** A searched place the To end was picked from (a6m): the exit is chosen for the walk to it, and a street-file walk graph
   *  is read for that; null for none (the quickest way out). */
  destination: Ground | null
  /** The load of the To station's walk graph (`useStationWalkLoads`), for `destination`; null with none. */
  walk: ReadonlyMap<StationId, WalkLoad> | null
}

export interface TripExit {
  /** The To station's interior file id: the path draws only while that interior is the focused one. */
  interiorId: string
  /** The scene position of that interior's origin: its local points (a choice's exit or entrance) are relative to it. */
  origin: Ground
  /** The way out the map draws: the selected journey's; null when it ends on foot. */
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
 * ready, the To station's interior and street files load (unless the To was filled from the location fix and never
 * picked or focused since: `allowed`) and every journey ending on a
 * train gets its exit line. Out-of-service machines are avoided; with no fresh outage data nothing counts as closed, and
 * a line that rides a machine says its status is unknown when the station panel would. A complex reads its file id's
 * street file and the alighting member's; the result waits until both settle, so a line never turns from a compass
 * way into a street name. Rebuilt only when what it reads changes (string keys), so the 30 s refresh and live polls
 * keep the same choice object and the drawn path's buffers.
 *
 * With a `destination` (the searched place the To end was picked from, a6m) the selected journey's exit is the one
 * that minimizes the walk inside the station plus the walk to it (`chooseExit`, over the station's walk graph when the
 * place is within its radius, else a straight estimate). Every stop the panel lists gets it, each reading its own
 * station's graph from `walk` (`useStationWalkLoads`; this hook loads none itself) and waiting for that one alone, so a
 * shard still loading leaves the other stops' lines in place; the exit never changes after it is drawn (a graph past
 * its deadline is ignored). With no destination every stop gets the quickest way out.
 */
export function useTripExit({ open, ends, plan, index, ene, nowS, selected, allowed, destination, walk }: TripExitInput): TripExit | null {
  const ready = allowed && open && plannable(ends) && plan.status === 'ready' && plan.key === tripKey(ends.from, ends.to)
  const stops = ready && plan.status === 'ready' ? finalRideStops(selectedFirst(plan.journeys, selected)) : []
  // Only the selected journey's own exit draws: one that ends on foot has none, whatever the others do.
  const drawnStop = selected ? drawnExitStop(selected) : null
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
  const [destX, destZ] = [destination?.x, destination?.z]
  const outages = joinStationOutages(model?.interior ?? null, ene, nowS)
  const outKey = outages.outIds.join(',')
  // As the station panel: still connecting says nothing; only stale, failed or mismatched data is "unknown".
  const known = outages.panel.kind !== 'unknown'

  const first = fileStreets.layer ?? memberStreets.layer
  const second = fileStreets.layer ? memberStreets.layer : null
  // The choices hang on the stops alone: a poll that swaps a train for its live twin keeps them, and the drawn path.
  const stopIdsKey = served.map((s) => s.stopId).join(',')
  // What each stop's choice reads of `walk`: whether its station's shard has settled, and whether it brought a graph.
  const walkKey = served
    .map((s) => {
      const load = walkLoadAt(walk, s.stopId)
      return `${s.stopId}${load === null ? '-' : load.settled ? (load.graph ? 'g' : 's') : 'p'}`
    })
    .join(',')
  const choices = useMemo(() => {
    const out = new Map<string, ExitChoice | null>()
    if (!model || !settled) return out
    const interior = model.interior
    const closed = new Set(outKey === '' ? [] : outKey.split(','))
    const file = first?.file ?? null
    served.forEach(({ stopId }) => {
      const toPoint = destX !== undefined && destZ !== undefined
      // A stop reads its own station's graph, and waits for it alone: another station's shard still loading leaves its line.
      const load = toPoint ? walkLoadAt(walk, stopId) : null
      if (load !== null && !load.settled) return
      out.set(
        stopId,
        safely(stopId, () =>
          toPoint ? chooseExit({ interior, stopId, destination: { x: destX, z: destZ }, walk: load?.graph ?? null, streets: file, closed }) : quickestExit({ interior, stopId, streets: file, closed }),
        ),
      )
    })
    return out
    // `served` is read through stopIdsKey, and `walk` through walkKey.
  }, [stopIdsKey, model, settled, first, outKey, destX, destZ, walkKey])

  return useMemo(() => {
    if (!model || !interiorId || served.length === 0 || !settled) return null
    const sources: StreetSource[] = [first, second].filter(isLayer).map((l) => ({ file: l.file, labels: l.entrances }))
    const lines = new Map<string, ExitLineView>()
    let mapLabel: ExitLabel | null = null
    served.forEach((stop, i) => {
      const choice = choices.get(stop.stopId)
      if (!choice) return
      const view = exitLineView(choice, model.interior, sources, known)
      if (i === 0 && stop.stopId === drawnStop) mapLabel = view.mapLabel
      for (const id of stop.tripIds) lines.set(id, view)
    })
    return { interiorId, origin: toGround(model.interior.anchor), drawn: served[0]!.stopId === drawnStop ? (choices.get(served[0]!.stopId) ?? null) : null, mapLabel, lines }
    // `served` is read through servedKey: a refresh with the same stops and trips keeps the result.
  }, [servedKey, drawnStop, interiorId, model, settled, first, second, choices, known])
}
