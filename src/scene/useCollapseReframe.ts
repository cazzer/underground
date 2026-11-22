import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { interiorCovers } from '../data/interiorLoad'
import { collapseAction, collapseDueIn, COLLAPSE_QUIET_MS, reframeGains, type CollapsePending } from '../lib/collapseReframe'
import type { FlyRequest } from '../lib/focus'
import { framedCount, type FramePoint } from '../lib/freeFrame'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import { reframeDuration, stationIsBare, type AwaitingInterior } from '../lib/interiorReframe'
import { usePanelCollapse } from '../lib/panelCollapse'
import { priorityTiers } from '../lib/pathFrame'
import { prefersReducedMotion } from '../lib/reducedMotion'
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
  /** The panel's measured rect: each move restarts the settle wait. */
  panel: ScreenRect | null
  focusedId: string | null
  flyRequest: FlyRequest | null
  following: () => boolean
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
 * new panel. Runs per event, never per frame.
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
  recheck,
}: CollapseReframeOptions): void {
  const { seq } = usePanelCollapse()
  const seen = useRef(seq)
  const timer = useRef<number | null>(null)
  const focused = useRef(focusedId)
  useLayoutEffect(() => {
    focused.current = focusedId
  }, [focusedId])

  const reframe = useCallback(
    (p: CollapsePending): boolean => {
      const c = controls.current
      const kind = awaiting.current?.kind
      const s = { flying: flight.current !== null, following: following(), focusedId: focused.current, tookOver: tookOver.current, lateArrival: kind === 'interior' || kind === 'streets' }
      if (!c || collapseAction(p, s) === 'drop') return false
      const l = layout.current
      const azimuth = c.getAzimuthalAngle()
      const target = collapseTarget(l, p.stationId, azimuth, camera.fov)
      if (!target) return false
      const { dest, tiers } = target
      const distance = camera.position.distanceTo(c.target)
      if (tiers) {
        const view = { azimuth, viewport: l.size, free: interiorFreeRect(l.size, l.insets, l.panel), fovDeg: camera.fov }
        const here = tiers.map((t) => framedCount(view, { distance, target: c.target }, t))
        const there = tiers.map((t) => framedCount(view, dest, t))
        if (!reframeGains(here, there, tiers.map((t) => t.length))) return false
      }
      const duration = reframeDuration(Math.max(c.target.distanceTo(dest.target), Math.abs(dest.distance - distance)), 0)
      if (duration === null) return false
      flushMotion(c, camera)
      const f = newFlight(dest, c, camera, p.reduced)
      if (!p.reduced) f.duration = duration
      flight.current = f
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
    const now = performance.now()
    collapse.current = { stationId: id, bumpedAt: now, panelAt: now, reduced: prefersReducedMotion() }
    timer.current = window.setTimeout(settle, COLLAPSE_QUIET_MS)
  }, [seq, collapse, flight, following, settle])

  // Each measured move of the panel restarts the quiet wait (up to the cap).
  useEffect(() => {
    if (collapse.current) collapse.current = { ...collapse.current, panelAt: performance.now() }
  }, [panel, collapse])

  // Another flight request, or the focus moving on, cancels a toggle still settling.
  useEffect(() => {
    collapse.current = null
  }, [flyRequest, collapse])
  useEffect(() => {
    const p = collapse.current
    if (!p || p.stationId === focusedId) return
    collapse.current = null
    recheck()
  }, [focusedId, collapse, recheck])

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
}
