import { useEffect, useMemo, useState } from 'react'
import type { TripIndexFile } from './schema'
import type { Network, ShapePath } from '../lib/network'
import type { TripJourney } from '../lib/route/plan'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
import { journeyKey, type TripSelection } from '../lib/tripSelection'
import { journeySpans, stopStations, type RideShapeSpan } from '../lib/tripSpans'
import type { TripPlanState } from '../lib/tripView'

interface TripRouteInput {
  network: Network
  /** The drawn shapes (banded once the bands arrive): the spans are found on what TripLines draws. */
  paths: readonly ShapePath[]
  open: boolean
  plan: TripPlanState
  selection: TripSelection
  /** The journey the map draws (useTrip's `selectedJourney`). */
  journey: TripJourney | null
}

type Patterns = TripIndexFile['patterns']
/** The patterns failed to load: spans are found by geometry alone. */
const NO_PATTERNS = 'none'

/** Everything a journey's spans depend on: each ride's route and every stop it calls at (an express and a local share a `journeyKey`). */
function legsKeyOf(journey: TripJourney): string {
  return journey.legs.map((l) => (l.kind === 'ride' ? `${l.routeId}:${l.stops.join(',')}` : `walk:${l.fromStop}:${l.toStop}:${l.sameStation}`)).join('>')
}

/**
 * The selected journey's ride legs on the drawn shapes, for TripLines: while the trip panel is open with a ready plan
 * and a journey selected (faint in the list view). Reads trip-index.json's patterns through the trip planner's loader
 * (its chunk, its one fetch, already made by the plan); until they settle nothing draws. A failed load logs once and
 * draws by geometry. A journey that can't be mapped logs and draws nothing. Leaves out `straight` spans and walks
 * (2q7.45.4).
 */
export function useTripRoute({ network, paths, open, plan, selection, journey }: TripRouteInput): TripRouteDraw | null {
  const enabled = open && plan.status === 'ready' && selection.view !== 'none' && journey !== null
  const [patterns, setPatterns] = useState<Patterns | typeof NO_PATTERNS | null>(null)
  useEffect(() => {
    if (!enabled || patterns !== null) return
    let current = true
    import('./loadTimetable')
      .then((m) => m.tripPatterns())
      .then(
        (p) => {
          if (current) setPatterns(p)
        },
        (err: unknown) => {
          console.error(`Trip route: no trip-index patterns (${err instanceof Error ? err.message : String(err)}); finding shapes by geometry`)
          if (current) setPatterns(NO_PATTERNS)
        },
      )
    return () => {
      current = false
    }
  }, [enabled, patterns])

  const stops = useMemo(() => stopStations(network.stations), [network])
  const legsKey = enabled && journey ? legsKeyOf(journey) : null
  const key = enabled && journey ? journeyKey(journey) : null
  const rides = useMemo((): readonly RideShapeSpan[] | null => {
    if (legsKey === null || journey === null || patterns === null) return null
    try {
      const spans = journeySpans(journey.legs, { shapes: paths, stopStations: stops, patterns: patterns === NO_PATTERNS ? undefined : patterns })
      return spans.filter((s): s is RideShapeSpan => s.kind === 'ride')
    } catch (err) {
      console.error(`Trip route: ${err instanceof Error ? err.message : String(err)}; not drawn`)
      return null
    }
    // `journey` is a new object on every replan; `legsKey` says when its legs really change.
  }, [legsKey, patterns, paths, stops])
  const faint = selection.view === 'list'
  return useMemo(() => (rides && key !== null ? { key, rides, faint } : null), [rides, key, faint])
}
