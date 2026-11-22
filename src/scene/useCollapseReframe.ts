import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { interiorCovers } from '../data/interiorLoad'
import { collapseAction, collapseDueIn, COLLAPSE_QUIET_MS, moveGains, type CollapsePending } from '../lib/collapseReframe'
import type { FlyRequest } from '../lib/focus'
import { framedCount, type FramePoint } from '../lib/freeFrame'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import { reframeDuration, stationIsBare, type AwaitingInterior } from '../lib/interiorReframe'
import { usePanelCollapse } from '../lib/panelCollapse'
import { priorityTiers } from '../lib/pathFrame'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { opensResizeWindow, panelMoveArms, RESIZE_WINDOW_MS, type ResizeWindow } from '../lib/resizeReframe'
import { useTrainSelection } from '../lib/trainSelection'
import { bareStationPoints, flushMotion, interiorFlight, newFlight, stationFlight, type Destination, type Flight, type MapControlsImpl } from './cameraFlight'
import type { ReframeLayout } from './useInteriorReframe'

interface CollapseReframeOptions {
  controls: RefObject<MapControlsImpl | null>
  camera: PerspectiveCamera
  flight: RefObject<Flight | null>
  /** The toggle waiting to reframe; CameraRig clears it on a gesture or another flight. */
  collapse: RefObject<CollapsePending | null>
  /** useInteriorReframe's await: a late interior or streets pending there reframe on their own. */
  awaiting: RefObject<AwaitingInterior | null>
  /** CameraRig sets it on a gesture and clears it on a landing: the user took the view over. */
  tookOver: RefObject<boolean>
  layout: RefObject<ReframeLayout>
  /** The panel's measured rect: each move restarts the settle wait, and inside the resize window arms a resize. */
  panel: ScreenRect | null
  focusedId: string | null
  flyRequest: FlyRequest | null
  following: () => boolean
  /** The trip panel is open: the station panel isn't in front. */
  tripOpen: boolean
  /** useInteriorReframe's ask, which waits while a toggle settles: asked again when this one doesn't move the camera. */
  recheck: () => void
}

/**
 * Where a reframe of `stationId` would land, and the priority points (by tier) both views are counted on (null for an
 * interior with no priority frame: its usual landing, taken whenever it moves); null for nothing to frame.
 */
function collapseTarget(l: ReframeLayout, stationId: string, azimuth: number, fovDeg: number): { dest: Destination; tiers: FramePoint[][] | null } | null {
  const { interior, frame } = l
  if (interior && interiorCovers(interior, stationId)) {
    const own = frame?.interiorId === interior.stationId ? frame : null
    return { dest: interiorFlight(stationId, interior, l.size, l.insets, l.panel, fovDeg, azimuth, false, own), tiers: own && priorityTiers(own) }
  }
  const station = l.network.stationById.get(stationId)
  // An interior still loading frames itself once it arrives (useInteriorReframe).
  if (!station || !stationIsBare(stationId, l.index)) return null
  const marks = bareStationPoints(stationId, l.streets, l.index)
  const dest = stationFlight(l.network, stationId, marks, l.size, l.insets, l.panel, fovDeg, azimuth)
  const level = (p: { x: number; z: number }): FramePoint => ({ x: p.x, y: 0, z: p.z })
  return { dest, tiers: [[level(station.pos)], marks.map(level)] }
}

/**
 * Reframes the focused station when the user collapses or expands the panel in front (usePanelCollapse's `seq`, so a
 * panel that changes size, appears or closes never starts one): once the panel's measurement settles
 * (collapseReframe.ts), an eased flight with no turn onto its priority frame in the new free area (an interior's
 * trip path or machines out of service, a bare station's entrances, else the interior's usual landing), when the view
 * doesn't already frame all of it. Reduced motion snaps. It declines when the user has panned, zoomed or turned since the
 * last landing, and while a late interior or streets reframe is pending (that one moves once, with its turn). A gesture,
 * another flight, a follow or a focus change cancels it. When it declines or has nothing to move, it asks
 * useInteriorReframe again: with the trip panel open its 'frame' await (#113) may still frame the trip's path onto the
 * new panel.
 *
 * A bare station's own landing opens a RESIZE_WINDOW_MS window (resizeReframe.ts, ost.18): a phone panel that changes
 * height inside it (or moved after the landed flight last framed) arms the same settle, then one reframe onto its
 * entrance marks when that shows strictly more. The window closes on that reframe (whose landing never reopens it), on
 * any pointer or key press, a fly request or its expiry, so later polls and the user's own list toggles never move the
 * camera. A pick made while a train panel is in front gets no window. A mid-flight change is the flight's retarget.
 * Returns the landing call CameraRig makes after useInteriorReframe's (stable, underground-by0). Runs per event, never
 * per frame.
 */
export function useCollapseReframe({
  controls,
  camera,
  flight,
  collapse,
  awaiting,
  tookOver,
  layout,
  panel,
  focusedId,
  flyRequest,
  following,
  tripOpen,
  recheck,
}: CollapseReframeOptions): (landed: Flight) => void {
  const { seq } = usePanelCollapse()
  const seen = useRef(seq)
  const timer = useRef<number | null>(null)
  const focused = useRef(focusedId)
  useLayoutEffect(() => {
    focused.current = focusedId
  }, [focusedId])
  /** The station of the last station fly request, when the station panel was in front at the request. */
  const flown = useRef<string | null>(null)
  /** The resize window, open just after a bare station's own landing. */
  const win = useRef<ResizeWindow | null>(null)
  /** The last flight this hook started: its landing never reopens the window. */
  const mine = useRef<Flight | null>(null)
  /** The panel and the free rect's bottom at its last measure. */
  const measured = useRef<{ panel: ScreenRect | null; bottom: number | null } | null>(null)
  const { selectedSummary, notice } = useTrainSelection()
  const stationFront = selectedSummary === null && notice === null && !tripOpen
  const front = useRef(stationFront)
  useLayoutEffect(() => {
    front.current = stationFront
  }, [stationFront])

  const reframe = useCallback(
    (p: CollapsePending): boolean => {
      const c = controls.current
      const kind = awaiting.current?.kind
      const l = layout.current
      const late = kind === 'interior' || kind === 'streets'
      const s = { flying: flight.current !== null, following: following(), focusedId: focused.current, tookOver: tookOver.current, lateArrival: late, bare: stationIsBare(p.stationId, l.index) }
      if (!c || collapseAction(p, s) === 'drop') return false
      const azimuth = c.getAzimuthalAngle()
      const target = collapseTarget(l, p.stationId, azimuth, camera.fov)
      if (!target) return false
      const { dest, tiers } = target
      const distance = camera.position.distanceTo(c.target)
      if (tiers) {
        const view = { azimuth, viewport: l.size, free: interiorFreeRect(l.size, l.insets, l.panel), fovDeg: camera.fov }
        const here = tiers.map((t) => framedCount(view, { distance, target: c.target }, t))
        const there = tiers.map((t) => framedCount(view, dest, t))
        if (!moveGains(p.kind, here, there, tiers.map((t) => t.length))) return false
      }
      const duration = reframeDuration(Math.max(c.target.distanceTo(dest.target), Math.abs(dest.distance - distance)), 0)
      if (duration === null) return false
      flushMotion(c, camera)
      const f = newFlight(dest, c, camera, p.reduced)
      if (!p.reduced) f.duration = duration
      flight.current = f
      mine.current = f
      if (p.kind === 'resize') win.current = null
      return true
    },
    [controls, camera, flight, awaiting, tookOver, layout, following],
  )

  const settle = useCallback(
    function settle() {
      timer.current = null
      const p = collapse.current
      if (!p) return
      const wait = collapseDueIn(p, performance.now())
      if (wait > 0) {
        timer.current = window.setTimeout(settle, wait)
        return
      }
      collapse.current = null
      if (!reframe(p)) recheck()
    },
    [collapse, reframe, recheck],
  )

  const arm = useCallback(
    (kind: CollapsePending['kind'], stationId: string) => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      const now = performance.now()
      collapse.current = { kind, stationId, bumpedAt: now, panelAt: now, reduced: prefersReducedMotion() }
      timer.current = window.setTimeout(settle, COLLAPSE_QUIET_MS)
    },
    [collapse, settle],
  )

  /** Whether a move of the free rect's bottom from `before` to `after` arms a resize now. */
  const resizeArms = useCallback(
    (before: number | null, after: number | null): boolean => {
      const l = layout.current
      const kind = awaiting.current?.kind
      return panelMoveArms(win.current, {
        nowMs: performance.now(),
        flying: flight.current !== null,
        following: following(),
        tookOver: tookOver.current,
        lateArrival: kind === 'interior' || kind === 'streets',
        focusedId: focused.current,
        width: l.size.width,
        height: l.size.height,
        before,
        after,
      })
    },
    [layout, awaiting, flight, following, tookOver],
  )

  // A user toggle. A flight under way retargets onto the new panel itself; a follow keeps the train framed.
  useLayoutEffect(() => {
    if (seq === seen.current) return
    seen.current = seq
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const id = focused.current
    if (!id || flight.current !== null || following()) {
      collapse.current = null
      return
    }
    arm('toggle', id)
  }, [seq, collapse, flight, following, arm])

  // Each measured move of the panel restarts the quiet wait (up to the cap); with none pending, one inside the resize
  // window arms a resize.
  useEffect(() => {
    const prev = measured.current
    if (prev && prev.panel === panel) return
    const l = layout.current
    const after = panel ? interiorFreeRect(l.size, l.insets, panel).bottom : null
    measured.current = { panel, bottom: after }
    if (collapse.current) collapse.current = { ...collapse.current, panelAt: performance.now() }
    else if (win.current && resizeArms(prev?.bottom ?? null, after)) arm('resize', win.current.stationId)
  }, [panel, collapse, layout, resizeArms, arm])

  // Another flight request, or the focus moving on, cancels a toggle still settling and closes the window. A pick made
  // while a train panel is in front (the train clears after the request) records no station, so it gets no window.
  useEffect(() => {
    collapse.current = null
    win.current = null
    flown.current = flyRequest?.kind === 'station' && front.current ? flyRequest.stationId : null
  }, [flyRequest, collapse])
  useEffect(() => {
    const p = collapse.current
    if (!p || p.stationId === focusedId) return
    collapse.current = null
    recheck()
  }, [focusedId, collapse, recheck])

  // Any pointer or key press is the user's: it closes the window and drops a resize still settling, so a "Show all"
  // tapped just after the landing never moves the camera. A collapse toggle arms its own after the press.
  useEffect(() => {
    const press = () => {
      win.current = null
      if (collapse.current?.kind === 'resize') collapse.current = null
    }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('keydown', press, true)
    return () => {
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('keydown', press, true)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [collapse])

  return useCallback(
    (f: Flight) => {
      const ours = f === mine.current
      mine.current = null
      win.current = null
      const id = focused.current
      const l = layout.current
      const kind = awaiting.current?.kind
      const opens = opensResizeWindow({
        landedId: f.stationId,
        mine: ours,
        follows: f.follows,
        flownId: flown.current,
        focusedId: id,
        stationFront: front.current,
        bare: id !== null && stationIsBare(id, l.index),
        flyingOn: flight.current !== null || kind === 'interior' || kind === 'streets',
      })
      if (!opens || !id) return
      win.current = { stationId: id, until: performance.now() + RESIZE_WINDOW_MS, width: l.size.width, height: l.size.height }
      // The panel moved after the flight last framed (no retarget folded it in): that counts as the window's move.
      const now = l.panel ? interiorFreeRect(l.size, l.insets, l.panel).bottom : null
      if (!collapse.current && resizeArms(f.freeBottom ?? null, now)) arm('resize', id)
    },
    [layout, awaiting, flight, collapse, resizeArms, arm],
  )
}
