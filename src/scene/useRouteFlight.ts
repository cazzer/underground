import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { flightProgress } from '../lib/flight'
import type { FlyRequest } from '../lib/focus'
import type { Insets, Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import type { Ground } from '../lib/projection'
import type { TripJourney } from '../lib/route/plan'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { legStationPoints, routeFramePoints } from '../lib/routeFrame'
import { routeFrameDecision, type RouteMemo, type RouteToken } from '../lib/routeFrameRule'
import { useTrainSelection } from '../lib/trainSelection'
import { useTrip } from '../lib/trip'
import { journeyKey } from '../lib/tripSelection'
import { journeySpans, stopStations } from '../lib/tripSpans'
import { rebaseFlight, type Destination, type Flight, type MapControlsImpl } from './cameraFlight'
import { freeBottom, landingOf, routeDestination, type RouteFlight } from './routeFlightState'
import { useRouteReframe } from './useRouteReframe'
import type { FlightLayout } from './useStationFlights'
import { useViewMoved } from './useViewMoved'

interface RouteFlightOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  /** CameraRig's `latest`: the panel, viewport, insets and zoom limit a flight frames with, read when it fires. */
  layout: RefObject<FlightLayout>
  network: Network
  flyRequest: FlyRequest | null
  /** CameraRig's: clears the focus hold and the pending reframes, then flies. */
  startFlight: (dest: Destination) => void
  following: () => boolean
  /** A gesture is in progress. */
  gesture: RefObject<boolean>
  /** A gesture began since the last landing. */
  tookOver: RefObject<boolean>
  panel: ScreenRect | null
  size: Viewport
  insets: Insets
}

/**
 * The points a journey draws: its spans on the map's shapes and its stations. A span that can't be drawn (a stop the
 * shapes don't reach) falls back to the stations alone, so both ends still show; a journey with no station throws.
 */
function journeyPoints(journey: TripJourney, network: Network, stops: ReturnType<typeof stopStations>): Ground[] {
  const stations = legStationPoints(journey.legs, stops)
  try {
    return routeFramePoints(journeySpans(journey.legs, { shapes: network.shapes, stopStations: stops }), network.shapeById, stations)
  } catch (e) {
    console.error('Trip route spans failed; framing its stations', e)
    return stations
  }
}

/**
 * Frames the whole selected trip route (2q7.45.5) when the trip panel is in front: top-down, north-up, at the smallest
 * distance (just past EXIT_DISTANCE or more) that fits every point of the journey the map draws in the free rect, once
 * per settled plan and again when the visitor opens or leaves a journey or its list (routeFrameRule.ts). A silent
 * refresh, a train panel or notice in front, a follow, a gesture, another flight, or the visitor moving the view (a drag
 * past the click slop, a pinch, a wheel step, a station pick) while the plan loaded never move it. Not a fly request:
 * focus drops after landing by the usual rules, and the basemap's location cap is left as it is. A panel or viewport
 * change retargets its flight, and useRouteReframe reframes after its landing. Returns the landing call CameraRig makes
 * (stable): any other flight's landing forgets this one.
 */
export function useRouteFlight({ controls, camera, flight, layout, network, flyRequest, startFlight, following, gesture, tookOver, panel, size, insets }: RouteFlightOptions): (landed: Flight) => void {
  const { open, ends, plan, selection, selectedJourney } = useTrip()
  const { selectedSummary, notice } = useTrainSelection()
  const front = open && selectedSummary === null && notice === null
  const stops = useMemo(() => stopStations(network.stations), [network])
  const memo = useRef<RouteMemo>({ framed: null, interrupted: false })
  const seenPlan = useRef(plan)
  const mine = useRef<RouteFlight | null>(null)

  // The visitor's own move while a plan loads keeps it from framing: a drag, pinch or wheel past the click slop, or a
  // station pick (a fly request after mount). A plain tap is not one.
  const moved = useCallback(() => {
    memo.current.interrupted = true
  }, [])
  useViewMoved(moved)
  const seenRequest = useRef(flyRequest)
  useEffect(() => {
    if (flyRequest === seenRequest.current) return
    seenRequest.current = flyRequest
    memo.current.interrupted = true
    mine.current = null
  }, [flyRequest])
  // A new run starts clean: a plan the cache answers in one commit may never be seen loading, so new ends or the panel
  // opening reset it too.
  useEffect(() => {
    if (plan.status !== 'ready') memo.current.interrupted = false
  }, [plan])
  useEffect(() => {
    memo.current.interrupted = false
  }, [open, ends.from, ends.to])

  // A panel or viewport change reframes the route's flight in the new free rect, at the same pace.
  useEffect(() => {
    const m = mine.current
    const c = controls.current
    if (!m || !c || flight.current !== m.flight) return
    const l = layout.current
    const dest = routeDestination(m.points, l, camera.fov)
    rebaseFlight(m.flight, dest, c, camera, c.getAzimuthalAngle(), flightProgress(m.flight.elapsed, m.flight.duration))
    m.landing = landingOf(dest, m.landing.at)
    m.bottom = freeBottom(l)
    m.width = l.size.width
    m.height = l.size.height
  }, [panel, size, insets, camera, controls, flight, layout])

  useRouteReframe({ controls, camera, flight, mine, layout, tookOver, following, front, startFlight, panel, size, insets })

  const journey = selectedJourney === null ? null : `${selection.view}:${journeyKey(selectedJourney)}`
  useEffect(() => {
    const silent = plan !== seenPlan.current && plan.status === 'ready' && (plan.trigger === 'tick' || plan.trigger === 'poll')
    seenPlan.current = plan
    const route: RouteToken | null = plan.status === 'ready' && selectedJourney !== null && journey !== null ? { plan: `${plan.key}#${plan.attempt}`, journey } : null
    const f = flight.current
    const flying = f === null ? null : f === mine.current?.flight ? 'mine' : 'other'
    const decision = routeFrameDecision(memo.current, { route, silent, front, flying, following: following(), gesture: gesture.current })
    if (decision === 'none') return
    memo.current.framed = route
    if (decision === 'skip' || selectedJourney === null) return
    try {
      const points = journeyPoints(selectedJourney, network, stops)
      const l = layout.current
      const dest = routeDestination(points, l, camera.fov)
      startFlight(dest)
      const started = flight.current
      // Only a flight this call started is ours: with no controls, startFlight starts none.
      mine.current =
        started && started !== f
          ? { flight: started, points, reduced: prefersReducedMotion(), landing: landingOf(dest, performance.now()), landedAt: null, width: l.size.width, height: l.size.height, bottom: freeBottom(l), windowOpen: true, resnapped: false, pending: null }
          : null
    } catch (e) {
      console.error('Trip route frame failed', e)
    }
    // Only a settled plan, its selected journey and the panel being in front decide; the rest is read as it stands.
  }, [plan, journey, front])

  return useCallback((landed: Flight) => {
    const m = mine.current
    if (m && landed === m.flight) m.landedAt = performance.now()
    else mine.current = null
  }, [])
}
