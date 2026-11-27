import { useMemo } from 'react'
import { boardLineKey, drawnBoardStop, firstRideStops, type BoardLine } from '../lib/boardView'
import { chooseEntry, quickestEntry, type BoardChoice, type BoardResult } from '../lib/exitChoice'
import { exitLineView, type ExitLabel, type StreetSource } from '../lib/exitView'
import { stationOfStop } from '../lib/live/arrivals'
import { joinStationOutages, type EneInput } from '../lib/live/eneJoin'
import type { Ground } from '../lib/projection'
import type { TripJourney } from '../lib/route/plan'
import { selectedFirst } from '../lib/tripSelection'
import { plannable, tripKey, type TripEnds, type TripPlanState } from '../lib/tripView'
import type { StationInterior } from './stationSchema'
import { interiorIdOf, type IndexLoad } from './interiorLoad'
import { useInteriorModel } from './useStationInterior'
import { useStationStreetsLoad, type StreetLayer } from './useStationStreets'
import type { WalkLoad } from './useStationWalk'
import type { WalkGraph } from './walkSchema'

interface TripBoardInput {
  /** The trip panel is open (covered by a train panel or not). */
  open: boolean
  ends: TripEnds
  plan: TripPlanState
  index: IndexLoad
  ene: EneInput
  nowS: number
  /** The journey the map draws the way in of: the opened one, else the first. */
  selected: TripJourney | null
  /** The From station and its complex's other members. */
  fromStations: ReadonlySet<string>
  /** The visitor chose the From station (it was not filled from a location fix, or they have since focused it): only
   *  then are its files fetched. */
  allowed: boolean
  /** A searched place the From end was picked from (a6m): the way in is chosen for the walk from it; null for none (the quickest way in). */
  origin: Ground | null
  /** The load of the From station's walk graph (`useStationWalkLoad`), for `origin`; null with none. */
  walk: WalkLoad | null
}

export interface TripBoard {
  /** The From station's interior file id: the path draws only while that interior is the focused one. */
  interiorId: string
  /** The way in the map draws: the selected journey's; null when it walks to another station first. */
  drawn: BoardChoice | null
  /** The street label naming the drawn way in's entrance, which the map's street labels place first and tint. */
  mapLabel: ExitLabel | null
  /** The trip panel's way-in line (or that there is none on the layout), by `boardLineKey` of a journey's first ride. */
  lines: ReadonlyMap<string, BoardLine>
}

/** A route search over interior data: a data error is logged and means no way-in line, never a crashed HUD. */
function safely(stopId: string, run: () => BoardResult): BoardResult | null {
  try {
    return run()
  } catch (err) {
    console.error(`Couldn't find the way in at ${stopId}`, err)
    return null
  }
}

/** No entrance reaches the stop's track even with every machine running. */
function layoutHasNoEntry(interior: StationInterior, stopId: string): boolean {
  const r = safely(stopId, () => quickestEntry({ interior, stopId }))
  return r?.kind === 'none' && r.reason === 'no-entrance'
}

/** Only the graph of the stop's own station answers for it; another member of the complex estimates its walk. */
function graphAt(graph: WalkGraph | null, stopId: string): WalkGraph | null {
  return graph !== null && graph.stationId === stationOfStop(stopId) ? graph : null
}

const isLayer = (l: StreetLayer | null | undefined): l is StreetLayer => l !== null && l !== undefined

/**
 * The quickest way in at the trip's From station, the way out's mirror (useTripExit): once a plan for the panel's ends
 * is ready, the From station's interior and street files load and every journey that boards its first train there gets
 * its way-in line. Nothing loads while `allowed` is false (a From filled from a location fix that the visitor has not
 * focused or picked: the request would name the fix's nearest station), and a journey that first walks to another
 * station gets no way in (that station comes from the plan). With an `origin` (the searched place the From end was
 * picked from, a6m) the selected journey's way in is the one that minimizes the walk from it plus the time inside
 * (`chooseEntry`), waiting for the walk graph to settle; this hook loads no walk graph itself (`walk` is
 * `useStationWalkLoad`'s). Every stop the panel lists gets it (a stop at another member of the complex estimates its walk), and with no origin the quickest way in. Machines out of service are avoided;
 * with no fresh outage data none count as closed, and the line says a machine's status is unknown when the station
 * panel would. Rebuilt only when what it reads changes, so refreshes keep the choice object and the drawn path.
 */
export function useTripBoard({ open, ends, plan, index, ene, nowS, selected, fromStations, allowed, origin, walk }: TripBoardInput): TripBoard | null {
  const ready = allowed && open && plannable(ends) && plan.status === 'ready' && plan.key === tripKey(ends.from, ends.to)
  const stops = ready && plan.status === 'ready' ? firstRideStops(selectedFirst(plan.journeys, selected), fromStations) : []
  const drawnStop = selected ? drawnBoardStop(selected, fromStations) : null
  const stationId = stops[0] ? stationOfStop(stops[0].stopId) : null
  const interiorId = interiorIdOf(stationId, index)
  // Only the stops the From interior covers (a complex covers every member's).
  const served = stops.filter((s) => interiorIdOf(stationOfStop(s.stopId), index) === interiorId)
  const servedKey = served.map((s) => `${s.stopId}=${s.tripIds.join('|')}`).join(',')
  const model = useInteriorModel(interiorId)
  const fileStreets = useStationStreetsLoad(interiorId)
  const memberStreets = useStationStreetsLoad(interiorId && stationId !== interiorId ? stationId : null)
  const walkSettled = origin === null || walk === null || walk.settled
  const settled = fileStreets.settled && memberStreets.settled && walkSettled
  const [originX, originZ] = [origin?.x, origin?.z]
  const graph = walk?.graph ?? null
  const outages = joinStationOutages(model?.interior ?? null, ene, nowS)
  const outKey = outages.outIds.join(',')
  const known = outages.panel.kind !== 'unknown'

  const first = fileStreets.layer ?? memberStreets.layer
  const second = fileStreets.layer ? memberStreets.layer : null
  const stopIdsKey = served.map((s) => s.stopId).join(',')
  const choices = useMemo(() => {
    const out = new Map<string, BoardResult | null>()
    if (!model || !settled) return out
    const closed = new Set(outKey === '' ? [] : outKey.split(','))
    const streets = first?.file ?? null
    served.forEach(({ stopId }) => {
      const interior = model.interior
      const fromPoint = originX !== undefined && originZ !== undefined
      out.set(
        stopId,
        safely(stopId, () =>
          fromPoint ? chooseEntry({ interior, stopId, origin: { x: originX, z: originZ }, walk: graphAt(graph, stopId), streets, closed }) : quickestEntry({ interior, stopId, streets, closed }),
        ),
      )
    })
    return out
    // `served` is read through stopIdsKey.
  }, [stopIdsKey, model, settled, first, outKey, originX, originZ, graph])

  return useMemo(() => {
    if (!model || !interiorId || served.length === 0 || !settled) return null
    const sources: StreetSource[] = [first, second].filter(isLayer).map((l) => ({ file: l.file, labels: l.entrances }))
    const lines = new Map<string, BoardLine>()
    let mapLabel: ExitLabel | null = null
    served.forEach((stop, i) => {
      const choice = choices.get(stop.stopId)
      let line: BoardLine | null = null
      if (choice?.kind === 'board') {
        const view = exitLineView(choice, model.interior, sources, known)
        if (i === 0 && stop.stopId === drawnStop) mapLabel = view.mapLabel
        line = { kind: 'path', view }
      } else if (choice?.kind === 'none' && choice.reason === 'no-entrance' && layoutHasNoEntry(model.interior, stop.stopId)) {
        // Only when the layout itself has no way in, not when machines out of service closed every one.
        line = { kind: 'no-entrance' }
      }
      if (line) for (const id of stop.tripIds) lines.set(boardLineKey(id, stationOfStop(stop.stopId)), line)
    })
    const lead = choices.get(served[0]!.stopId)
    const drawn = served[0]!.stopId === drawnStop && lead?.kind === 'board' ? lead : null
    return { interiorId, drawn, mapLabel, lines }
    // `served` is read through servedKey: a refresh with the same stops and trips keeps the result.
  }, [servedKey, drawnStop, interiorId, model, settled, first, second, choices, known])
}
