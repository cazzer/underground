import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { collapseDueIn, COLLAPSE_QUIET_MS } from '../lib/collapseReframe'
import type { Insets, Viewport } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { reframeDuration } from '../lib/interiorReframe'
import { usePanelCollapse } from '../lib/panelCollapse'
import { shouldResnapPoint } from '../lib/pointResnap'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { routeIsFramed, type RouteToken } from '../lib/routeFrameRule'
import { routeMoveArms, routePending, routeReframeAction } from '../lib/routeReframe'
import type { Destination, Flight, MapControlsImpl } from './cameraFlight'
import { freeBottom, landingOf, routeDestination, type RouteFlight } from './routeFlightState'
import type { FlightLayout } from './useStationFlights'

interface RouteReframeOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  mine: RefObject<RouteFlight | null>
  /** The route the map draws now. */
  current: RefObject<RouteToken | null>
  layout: RefObject<FlightLayout>
  tookOver: RefObject<boolean>
  following: () => boolean
  /** The trip panel is in front. */
  front: boolean
  startFlight: (dest: Destination) => void
  panel: ScreenRect | null
  size: Viewport
  insets: Insets
}

/**
 * After the route flight lands (it must be the last landing, the trip panel in front, no gesture since), reframes onto
 * the route once when the panel is collapsed or expanded, or when it changes height inside RESIZE_WINDOW_MS of the
 * landing (routeReframe.ts), after the panel's measurement settles; reduced motion snaps. A press closes the window and
 * drops a resize waiting; a gesture, another flight, a follow or the panel going cancel it. A reduced-motion landing
 * also re-snaps once just after, on a size or inset change, as a point flight does. Per event, never per frame.
 */
export function useRouteReframe({ controls, camera, flight, mine, current, layout, tookOver, following, front, startFlight, panel, size, insets }: RouteReframeOptions): void {
  const { seq } = usePanelCollapse()
  const seen = useRef(seq)
  const timer = useRef<number | null>(null)
  const frontRef = useRef(front)
  useLayoutEffect(() => {
    frontRef.current = front
  }, [front])

  /** Flies onto the route in the layout as it is now; true when it started a flight. */
  const reframe = useCallback(
    (m: RouteFlight, reduced: boolean): boolean => {
      const c = controls.current
      if (!c) return false
      const landed = m.landedAt !== null
      if (routeReframeAction({ flying: flight.current !== null, following: following(), tookOver: tookOver.current, landed, front: frontRef.current, sameRoute: routeIsFramed(m.token, current.current), reduced }) === 'drop') return false
      const l = layout.current
      const dest = routeDestination(m.points, l, camera.fov)
      const distance = camera.position.distanceTo(c.target)
      const duration = reframeDuration(Math.max(c.target.distanceTo(dest.target), Math.abs(dest.distance - distance)), 0)
      if (duration === null) return false
      const before = flight.current
      startFlight(dest)
      const f = flight.current
      if (!f || f === before) return false
      if (!reduced) f.duration = duration
      Object.assign(m, { flight: f, landedAt: null, landing: landingOf(dest, performance.now()), width: l.size.width, height: l.size.height, bottom: freeBottom(l), windowOpen: false })
      return true
    },
    [controls, camera, flight, current, layout, tookOver, following, startFlight],
  )

  const settle = useCallback(
    function settle() {
      timer.current = null
      const m = mine.current
      const p = m?.pending
      if (!m || !p) return
      const wait = collapseDueIn(p, performance.now())
      if (wait > 0) {
        timer.current = window.setTimeout(settle, wait)
        return
      }
      m.pending = null
      reframe(m, p.reduced)
    },
    [mine, reframe],
  )

  const arm = useCallback(
    (m: RouteFlight, kind: 'toggle' | 'resize') => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      m.pending = routePending(kind, performance.now(), prefersReducedMotion())
      if (kind === 'resize') m.windowOpen = false
      timer.current = window.setTimeout(settle, COLLAPSE_QUIET_MS)
    },
    [settle],
  )

  // A user collapse or expand of the panel in front: a flight under way retargets onto the new panel itself.
  useLayoutEffect(() => {
    if (seq === seen.current) return
    seen.current = seq
    const m = mine.current
    if (!m) return
    if (m.landedAt === null || flight.current !== null || following() || tookOver.current || !frontRef.current) {
      m.pending = null
      return
    }
    arm(m, 'toggle')
  }, [seq, mine, flight, following, tookOver, arm])

  // Each measured move of the panel after the landing restarts the quiet wait; with none waiting, a re-snap under
  // reduced motion, or one inside the window that moves the free rect's bottom arms a resize.
  useEffect(() => {
    const m = mine.current
    const c = controls.current
    if (!m || !c || m.landedAt === null) return
    const now = performance.now()
    if (m.pending) {
      m.pending.panelAt = now
      return
    }
    const l = layout.current
    const dest = routeDestination(m.points, l, camera.fov)
    const distance = camera.position.distanceTo(c.target)
    if (m.reduced && !m.resnapped && shouldResnapPoint(m.landing, { now, flying: flight.current !== null, tookOver: tookOver.current, target: c.target, distance })) {
      const before = flight.current
      startFlight(dest)
      if (flight.current && flight.current !== before) Object.assign(m, { flight: flight.current, landedAt: null, resnapped: true, bottom: freeBottom(l) })
      return
    }
    const landed = { landedAt: m.landedAt, width: m.width, height: m.height }
    const input = { nowMs: now, flying: flight.current !== null, following: following(), tookOver: tookOver.current, width: l.size.width, height: l.size.height, before: m.bottom, after: freeBottom(l) }
    if (routeMoveArms(landed, m.windowOpen, input)) arm(m, 'resize')
  }, [panel, size, insets, camera, controls, flight, layout, mine, tookOver, following, startFlight, arm])

  // Any pointer or key press is the visitor's: it closes the window and drops a resize still settling.
  useEffect(() => {
    const press = () => {
      const m = mine.current
      if (!m) return
      m.windowOpen = false
      if (m.pending?.kind === 'resize') m.pending = null
    }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('keydown', press, true)
    return () => {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('keydown', press, true)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [mine])
}
