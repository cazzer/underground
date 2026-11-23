import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { flightProgress } from '../lib/flight'
import type { FlyRequest } from '../lib/focus'
import type { Insets, Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { routeFramePoints } from '../lib/routeFrame'
import { changeToken, isChangeToken, routeFrameDecision, routeIsFramed, type RouteMemo, type RouteToken } from '../lib/routeFrameRule'
import { usePanelCollapse } from '../lib/panelCollapse'
import { useTrip } from '../lib/trip'
import type { TripRouteDraw } from '../lib/tripLineBuffers'
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
  /** The route view TripLines draws (a picked change, else the trip's journey): the spans the frame covers; null while it has none. */
  route: TripRouteDraw | null
  panel: ScreenRect | null
  size: Viewport
  insets: Insets
}

/**
 * Frames the whole route view (2q7.45.5; 08r.6) when its panel is in front: top-down, north-up, at the smallest
 * distance (just past EXIT_DISTANCE or more) that fits every ride the map draws (TripLines' spans, a change's suspended
 * ones and TripDashes' straight ones, `route`) and its `frameStations` in the free rect. A trip frames once
 * per settled plan and again when the visitor opens or leaves a journey or its list (routeFrameRule.ts); a picked
 * service change once per pick, while the changes list is in front. Each kind remembers what it framed, so the trip
 * isn't framed again on coming back from a change. A silent
 * refresh, a train panel or notice in front, a follow, a gesture, another flight, or the visitor moving the view (a drag
 * past the click slop, a pinch, a wheel step, a station pick) while the plan loaded never move it. Not a fly request:
 * focus drops after landing by the usual rules, and the basemap's location cap is left as it is. A panel or viewport
 * change retargets its flight, and useRouteReframe reframes after its landing. Returns the landing call CameraRig makes
 * (stable): any other flight's landing forgets this one. With no route drawn (`route` null: its patterns still
 * loading, its spans unmappable, or nothing but changes inside a station) nothing frames.
 */
export function useRouteFlight({ controls, camera, flight, layout, network, flyRequest, startFlight, following, gesture, tookOver, route, panel, size, insets }: RouteFlightOptions): (landed: Flight) => void {
  const { open, ends, plan, selection } = useTrip()
  const change = route?.kind === 'change'
  const frontPanel = usePanelCollapse().front
  const front = change ? frontPanel === 'changes' : frontPanel === 'trip'
  /** What each kind last decided on: coming back to the trip from a change finds the trip still framed. */
  const memo = useState((): Record<'trip' | 'change', RouteMemo> => ({ trip: { framed: null, interrupted: false }, change: { framed: null, interrupted: false } }))[0]
  const seenPlan = useRef(plan)
  const mine = useRef<RouteFlight | null>(null)
  /** The route the map draws now (null while no plan is ready): the reframes only ever frame that one. */
  const current = useRef<RouteToken | null>(null)

  // The visitor's own move while a plan loads keeps it from framing: a drag, pinch or wheel past the click slop, or a
  // station pick (a fly request after mount). A plain tap is not one.
  const moved = useCallback(() => {
    memo.trip.interrupted = memo.change.interrupted = true
  }, [memo])
  useViewMoved(moved)
  const seenRequest = useRef(flyRequest)
  useEffect(() => {
    if (flyRequest === seenRequest.current) return
    seenRequest.current = flyRequest
    memo.trip.interrupted = memo.change.interrupted = true
    mine.current = null
  }, [flyRequest, memo])
  // A new run starts clean: a plan the cache answers in one commit may never be seen loading, so new ends, the panel
  // opening and a retry's settling reset it too, and the route the last run framed goes with its plan (a change's
  // flight is not the trip's to forget).
  const forgetTrip = useCallback(() => {
    memo.trip.interrupted = false
    if (mine.current && !isChangeToken(mine.current.token)) mine.current = null
  }, [memo])
  const seenAttempt = useRef<number | null>(null)
  useEffect(() => {
    if (plan.status !== 'ready') {
      forgetTrip()
      return
    }
    if (plan.trigger === 'retry' && plan.attempt !== seenAttempt.current) memo.trip.interrupted = false
    seenAttempt.current = plan.attempt
  }, [plan, memo, forgetTrip])
  useEffect(forgetTrip, [open, ends.from, ends.to, forgetTrip])
  // Each pick starts clean: only a move between the pick and its draw keeps it from framing.
  const changeKey = change ? route.key : null
  useEffect(() => {
    if (changeKey !== null) memo.change.interrupted = false
  }, [changeKey, memo])

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

  const journey = route === null ? null : change ? route.key : `${selection.view}:${route.key}`
  useEffect(() => {
    const planChanged = plan !== seenPlan.current
    seenPlan.current = plan
    const silent = !change && planChanged && plan.status === 'ready' && (plan.trigger === 'tick' || plan.trigger === 'poll')
    const token: RouteToken | null =
      route === null || journey === null ? null : change ? changeToken(route.key) : plan.status === 'ready' ? { plan: `${plan.key}#${plan.attempt}`, journey } : null
    current.current = token
    const kindMemo = change ? memo.change : memo.trip
    const f = flight.current
    const flying = f === null ? null : f === mine.current?.flight ? 'mine' : 'other'
    const decision = routeFrameDecision(kindMemo, { route: token, silent, front, flying, following: following(), gesture: gesture.current })
    // A route other than the one the flight framed (skipped, or none) is not the one to reframe onto.
    if (decision !== 'fly' && mine.current && !routeIsFramed(mine.current.token, token)) mine.current = null
    if (decision === 'none') return
    kindMemo.framed = token
    if (decision === 'skip' || route === null) return
    try {
      const points = routeFramePoints([...route.rides, ...route.suspended, ...route.straights], network.shapeById, route.frameStations)
      const l = layout.current
      const dest = routeDestination(points, l, camera.fov)
      startFlight(dest)
      const started = flight.current
      // Only a flight this call started is ours: with no controls, startFlight starts none.
      mine.current =
        started && started !== f
          ? { flight: started, token: token!, points, reduced: prefersReducedMotion(), landing: landingOf(dest, performance.now()), landedAt: null, width: l.size.width, height: l.size.height, bottom: freeBottom(l), windowOpen: true, resnapped: false, pending: null }
          : null
    } catch (e) {
      console.error(change ? 'Service change frame failed' : 'Trip route frame failed', e)
    }
    // Only a settled plan, the route drawn (its journey or pick) and its panel being in front decide; the rest is read as it stands.
  }, [plan, journey, change, front])

  return useCallback((landed: Flight) => {
    const m = mine.current
    if (m && landed === m.flight) m.landedAt = performance.now()
    else mine.current = null
  }, [])
}
