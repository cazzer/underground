import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { flightProgress } from '../lib/flight'
import type { FlyRequest } from '../lib/focus'
import type { Insets, Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { legStationPoints, routeFramePoints } from '../lib/routeFrame'
import { routeFrameDecision, routeIsFramed, type RouteMemo, type RouteToken } from '../lib/routeFrameRule'
import { usePanelCollapse } from '../lib/panelCollapse'
import { useTrip } from '../lib/trip'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
import { stopStations } from '../lib/tripSpans'
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
  /** What TripLines draws (useTripRoute): the ride spans the frame covers; null while it has none to draw. */
  tripRoute: TripRouteDraw | null
  panel: ScreenRect | null
  size: Viewport
  insets: Insets
}

/**
 * Frames the whole selected trip route (2q7.45.5) when the trip panel is in front: top-down, north-up, at the smallest
 * distance (just past EXIT_DISTANCE or more) that fits every ride the map draws (TripLines' spans and TripDashes' straight ones, `tripRoute`) and the journey's stations in the free rect, once
 * per settled plan and again when the visitor opens or leaves a journey or its list (routeFrameRule.ts). A silent
 * refresh, a train panel or notice in front, a follow, a gesture, another flight, or the visitor moving the view (a drag
 * past the click slop, a pinch, a wheel step, a station pick) while the plan loaded never move it. Not a fly request:
 * focus drops after landing by the usual rules, and the basemap's location cap is left as it is. A panel or viewport
 * change retargets its flight, and useRouteReframe reframes after its landing. Returns the landing call CameraRig makes
 * (stable): any other flight's landing forgets this one. With no route drawn (`tripRoute` null: its patterns still
 * loading, its spans unmappable, or nothing but changes inside a station) nothing frames.
 */
export function useRouteFlight({ controls, camera, flight, layout, network, flyRequest, startFlight, following, gesture, tookOver, tripRoute, panel, size, insets }: RouteFlightOptions): (landed: Flight) => void {
  const { open, ends, plan, selection, selectedJourney } = useTrip()
  const front = usePanelCollapse().front === 'trip'
  const stops = useMemo(() => stopStations(network.stations), [network])
  const memo = useRef<RouteMemo>({ framed: null, interrupted: false })
  const seenPlan = useRef(plan)
  const mine = useRef<RouteFlight | null>(null)
  /** The route the map draws now (null while no plan is ready): the reframes only ever frame that one. */
  const current = useRef<RouteToken | null>(null)

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
  // A new run starts clean: a plan the cache answers in one commit may never be seen loading, so new ends, the panel
  // opening and a retry's settling reset it too, and the route the last run framed goes with its plan.
  const seenAttempt = useRef<number | null>(null)
  useEffect(() => {
    if (plan.status !== 'ready') {
      memo.current.interrupted = false
      mine.current = null
      return
    }
    if (plan.trigger === 'retry' && plan.attempt !== seenAttempt.current) memo.current.interrupted = false
    seenAttempt.current = plan.attempt
  }, [plan])
  useEffect(() => {
    memo.current.interrupted = false
    mine.current = null
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

  useRouteReframe({ controls, camera, flight, mine, current, layout, tookOver, following, front, startFlight, panel, size, insets })

  const journey = tripRoute === null ? null : `${selection.view}:${tripRoute.key}`
  useEffect(() => {
    const silent = plan !== seenPlan.current && plan.status === 'ready' && (plan.trigger === 'tick' || plan.trigger === 'poll')
    seenPlan.current = plan
    const route: RouteToken | null = plan.status === 'ready' && tripRoute !== null && selectedJourney !== null && journey !== null ? { plan: `${plan.key}#${plan.attempt}`, journey } : null
    current.current = route
    const f = flight.current
    const flying = f === null ? null : f === mine.current?.flight ? 'mine' : 'other'
    const decision = routeFrameDecision(memo.current, { route, silent, front, flying, following: following(), gesture: gesture.current })
    // A route other than the one the flight framed (skipped, or none) is not the one to reframe onto.
    if (decision !== 'fly' && mine.current && !routeIsFramed(mine.current.token, route)) mine.current = null
    if (decision === 'none') return
    memo.current.framed = route
    if (decision === 'skip' || selectedJourney === null || tripRoute === null) return
    try {
      const points = routeFramePoints([...tripRoute.rides, ...tripRoute.straights], network.shapeById, legStationPoints(selectedJourney.legs, stops))
      const l = layout.current
      const dest = routeDestination(points, l, camera.fov)
      startFlight(dest)
      const started = flight.current
      // Only a flight this call started is ours: with no controls, startFlight starts none.
      mine.current =
        started && started !== f
          ? { flight: started, token: route!, points, reduced: prefersReducedMotion(), landing: landingOf(dest, performance.now()), landedAt: null, width: l.size.width, height: l.size.height, bottom: freeBottom(l), windowOpen: true, resnapped: false, pending: null }
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
