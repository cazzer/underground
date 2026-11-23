import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import { Vector3, type PerspectiveCamera } from 'three'
import { flightProgress } from '../lib/flight'
import type { FlyRequest } from '../lib/focus'
import { EXIT_DISTANCE } from '../lib/focusMachine'
import type { Insets, Viewport } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import { shouldResnapPoint, type PointLanding } from '../lib/pointResnap'
import type { Ground } from '../lib/projection'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { frameTopDown, legStationPoints, routeFramePoints } from '../lib/routeFrame'
import { routeFrameDecision, type RouteMemo, type RouteToken } from '../lib/routeFrameRule'
import { useTrainSelection } from '../lib/trainSelection'
import { useTrip } from '../lib/trip'
import { journeyKey } from '../lib/tripSelection'
import { journeySpans, stopStations } from '../lib/tripSpans'
import { rebaseFlight, type Destination, type Flight, type MapControlsImpl } from './cameraFlight'
import type { FlightLayout } from './useStationFlights'

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

/** The flight this hook started, with what it framed, so a panel or viewport change can reframe it. */
interface Mine {
  flight: Flight
  points: readonly Ground[]
  reduced: boolean
  landing: PointLanding
}

function destination(points: readonly Ground[], l: FlightLayout, fovDeg: number): Destination {
  const free = interiorFreeRect(l.size, l.insets, l.panel)
  const { distance, target } = frameTopDown(points, l.size, free, fovDeg, EXIT_DISTANCE, l.maxDistance)
  return { stationId: null, target: new Vector3(target.x, 0, target.z), distance, azimuth: 0, follows: false }
}

const landingOf = (dest: Destination, at: number): PointLanding => ({ at, target: { x: dest.target.x, z: dest.target.z }, distance: dest.distance })

/**
 * Frames the whole selected trip route (2q7.45.5) when the trip panel is in front: top-down, north-up, at the smallest
 * distance (EXIT_DISTANCE or more) that fits every point of the journey the map draws in the free rect, once per
 * settled plan and again when the visitor opens or leaves a journey (routeFrameRule.ts). A silent refresh, a train
 * panel or notice in front, a follow, a gesture, another flight, or a gesture or station pick while the plan loaded
 * never move it. Not a fly request: focus drops after landing by the usual rules, and the basemap's location cap is
 * left as it is. A panel or viewport change retargets its flight (a reduced-motion landing re-snaps once just after
 * it, as a point flight does). Returns `interrupt`, which CameraRig calls on every gesture start (stable).
 */
export function useRouteFlight({ controls, camera, flight, layout, network, flyRequest, startFlight, following, gesture, tookOver, panel, size, insets }: RouteFlightOptions): { interrupt: () => void } {
  const { open, plan, selectedJourney } = useTrip()
  const { selectedSummary, notice } = useTrainSelection()
  const front = open && selectedSummary === null && notice === null
  const stops = useMemo(() => stopStations(network.stations), [network])
  const memo = useRef<RouteMemo>({ framed: null, interrupted: false })
  const seenPlan = useRef(plan)
  const mine = useRef<Mine | null>(null)

  const interrupt = useCallback(() => {
    memo.current.interrupted = true
  }, [])

  // The visitor's own move while a plan loads keeps it from framing: a station pick (a fly request after mount).
  const seenRequest = useRef(flyRequest)
  useEffect(() => {
    if (flyRequest === seenRequest.current) return
    seenRequest.current = flyRequest
    memo.current.interrupted = true
  }, [flyRequest])
  useEffect(() => {
    if (plan.status === 'loading') memo.current.interrupted = false
  }, [plan])

  // A panel or viewport change reframes the route's flight in the new free rect, at the same pace.
  useEffect(() => {
    const m = mine.current
    const c = controls.current
    if (!m || !c) return
    const f = flight.current
    const dest = destination(m.points, layout.current, camera.fov)
    if (f === m.flight) {
      rebaseFlight(f, dest, c, camera, c.getAzimuthalAngle(), flightProgress(f.elapsed, f.duration))
      m.landing = landingOf(dest, m.landing.at)
      return
    }
    mine.current = null
    if (!m.reduced) return
    const now = { now: performance.now(), flying: f !== null, tookOver: tookOver.current, target: c.target, distance: camera.position.distanceTo(c.target) }
    if (shouldResnapPoint(m.landing, now)) startFlight(dest)
  }, [panel, size, insets, camera, controls, flight, layout, tookOver, startFlight])

  const journey = selectedJourney === null ? null : journeyKey(selectedJourney)
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
      const ctx = { shapes: network.shapes, stopStations: stops }
      const points = routeFramePoints(journeySpans(selectedJourney.legs, ctx), network.shapeById, legStationPoints(selectedJourney.legs, stops))
      const dest = destination(points, layout.current, camera.fov)
      startFlight(dest)
      const started = flight.current
      mine.current = started ? { flight: started, points, reduced: prefersReducedMotion(), landing: landingOf(dest, performance.now()) } : null
    } catch (e) {
      console.error('Trip route frame failed', e)
    }
    // Only a settled plan, its selected journey and the panel being in front decide; the rest is read as it stands.
  }, [plan, journey, front])

  return { interrupt }
}
