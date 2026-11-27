import { useEffect, useMemo, useState } from 'react'
import type { TripIndexFile } from './schema'
import type { Network, ShapePath } from '../lib/network'
import type { TripJourney } from '../lib/route/plan'
import { legStationPoints } from '../lib/routeFrame'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
import { tripMarks, tripStationIds } from '../lib/tripMarks'
import { journeyKey, type TripSelection } from '../lib/tripSelection'
import { journeySpans, stopStations, type RideShapeSpan, type RideStraightSpan, type WalkSpan } from '../lib/tripSpans'
import type { TripPlanState } from '../lib/tripView'
import { withWalkPaths } from '../lib/tripWalkPaths'
import { useTransferWalks } from './useTransferWalks'

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

/** Each walk pair that fell back to the straight dash is warned about once per page load. */
const warnedWalks = new Set<string>()

/** Everything a journey's spans depend on: each ride's route and every stop it calls at (an express and a local share a `journeyKey`). */
function legsKeyOf(journey: TripJourney): string {
  return journey.legs.map((l) => (l.kind === 'ride' ? `${l.routeId}:${l.stops.join(',')}` : `walk:${l.fromStop}:${l.toStop}:${l.sameStation}`)).join('>')
}

/**
 * The selected journey on the drawn shapes, while the trip panel is open with a ready plan and a journey selected
 * (faint in the list view): its ride legs for TripLines, its `straight` rides and walks between stations for
 * TripDashes, its board, change and alight marks for TripMarks and the stations it calls at. Reads trip-index.json's
 * patterns through the trip planner's loader (its chunk, its one fetch, already made by the plan); until they settle
 * nothing draws. A failed load logs once and draws by geometry. A walk between two complexes' stations follows the street
 * network (`useTransferWalks`, 85r) and waits for its walk graphs to settle, so it never draws straight and then swaps;
 * with no path it stays the straight dash, warned once. A journey that can't be mapped logs and draws nothing.
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
  const walkGraphs = useTransferWalks(network, open && plan.status === 'ready')
  const legsKey = enabled && journey ? legsKeyOf(journey) : null
  const key = enabled && journey ? journeyKey(journey) : null
  const drawn = useMemo((): Omit<TripRouteDraw, 'kind' | 'key' | 'faint'> | null => {
    if (legsKey === null || journey === null || patterns === null) return null
    try {
      const spans = journeySpans(journey.legs, { shapes: paths, stopStations: stops, patterns: patterns === NO_PATTERNS ? undefined : patterns })
      // A walk between complexes follows the streets once the shards settle; until then nothing draws.
      const crossWalks = spans.filter((s): s is WalkSpan => s.kind === 'walk' && !s.sameComplex)
      if (crossWalks.length > 0 && !walkGraphs.settled) return null
      const walks = withWalkPaths(crossWalks, walkGraphs.graphs, (w, reason) => {
        const pair = `${w.fromStationId}>${w.toStationId}`
        if (warnedWalks.has(pair)) return
        warnedWalks.add(pair)
        console.warn(`Trip walk ${w.fromStationId} to ${w.toStationId} drawn straight: ${reason}`)
      })
      return {
        rides: spans.filter((s): s is RideShapeSpan => s.kind === 'ride'),
        straights: spans.filter((s): s is RideStraightSpan => s.kind === 'straight'),
        // A walk between a complex's members is a change inside one station as the UI shows it: its marks say so.
        walks,
        suspended: [],
        marks: tripMarks(journey.legs, stops),
        stations: tripStationIds(journey.legs, stops),
        frameStations: legStationPoints(journey.legs, stops),
      }
    } catch (err) {
      console.error(`Trip route: ${err instanceof Error ? err.message : String(err)}; not drawn`)
      return null
    }
    // `journey` is a new object on every replan; `legsKey` says when its legs really change.
  }, [legsKey, patterns, paths, stops, walkGraphs])
  const faint = selection.view === 'list'
  // Nothing to draw (no leg mapped and no walk between stations): nothing shows, so the network isn't dimmed either.
  const any = drawn !== null && (drawn.rides.length > 0 || drawn.straights.length > 0 || drawn.walks.length > 0)
  return useMemo(() => (any && drawn && key !== null ? { kind: 'trip' as const, key, ...drawn, faint } : null), [any, drawn, key, faint])
}
