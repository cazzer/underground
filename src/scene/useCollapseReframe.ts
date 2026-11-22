import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import type { PerspectiveCamera } from 'three'
import { interiorCovers } from '../data/interiorLoad'
import { collapseAction, collapseDueIn, COLLAPSE_QUIET_MS, moveGains, panelMoveArms, type CollapsePending } from '../lib/collapseReframe'
import type { FlyRequest } from '../lib/focus'
import { framedCount, type FramePoint } from '../lib/freeFrame'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import { reframeDuration, stationIsBare, type AwaitingInterior } from '../lib/interiorReframe'
import { usePanelCollapse } from '../lib/panelCollapse'
import { priorityTiers } from '../lib/pathFrame'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { useTrainSelection } from '../lib/trainSelection'
import { useTrip } from '../lib/trip'
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
  /** The panel's measured rect: each move restarts the settle wait, and on a landed bare station arms a resize reframe. */
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
 * new panel.
 *
 * A landed bare station's panel that changes height on a phone (the Entrances row arriving with its streets, a "Show
 * all" opened) arms the same settle and reframe onto its entrance marks, only while the station panel has stayed in
 * front since the station's own flight and the user hasn't taken over, and only when that shows strictly more
 * (collapseReframe.ts, ost.18). A pending late streets reframe reads the final panel itself; a mid-flight change is the
 * flight's retarget. Runs per event, never per frame.
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
  /** The station of the last station flight, while the station panel has stayed in front since. */
  const flown = useRef<string | null>(null)
  /** The free rect's bottom and the viewport at the panel's last measure. */
  const measured = useRef<{ panel: ScreenRect | null; bottom: number | null; width: number; height: number } | null>(null)
  const { selectedSummary, notice } = useTrainSelection()
  const { open: tripOpen } = useTrip()
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
    collapse.current = { kind: 'toggle', stationId: id, bumpedAt: now, panelAt: now, reduced: prefersReducedMotion() }
    timer.current = window.setTimeout(settle, COLLAPSE_QUIET_MS)
  }, [seq, collapse, flight, following, settle])

  // Each measured move of the panel restarts the quiet wait (up to the cap); with none pending, a landed bare station's
  // panel that changed height arms a resize.
  useEffect(() => {
    const prev = measured.current
    if (prev && prev.panel === panel) return
    const l = layout.current
    const after = panel ? interiorFreeRect(l.size, l.insets, panel).bottom : null
    measured.current = { panel, bottom: after, width: l.size.width, height: l.size.height }
    if (collapse.current) {
      collapse.current = { ...collapse.current, panelAt: performance.now() }
      return
    }
    const id = focused.current
    const kind = awaiting.current?.kind
    const arms = panelMoveArms({
      flying: flight.current !== null,
      following: following(),
      tookOver: tookOver.current,
      lateArrival: kind === 'interior' || kind === 'streets',
      focusedId: id,
      flownId: front.current ? flown.current : null,
      bare: id !== null && stationIsBare(id, l.index),
      before: prev?.bottom ?? null,
      after,
      sameViewport: prev !== null && prev.width === l.size.width && prev.height === l.size.height,
    })
    if (!arms || !id) return
    if (timer.current !== null) window.clearTimeout(timer.current)
    const now = performance.now()
    collapse.current = { kind: 'resize', stationId: id, bumpedAt: now, panelAt: now, reduced: prefersReducedMotion() }
    timer.current = window.setTimeout(settle, COLLAPSE_QUIET_MS)
  }, [panel, collapse, layout, awaiting, flight, tookOver, following, settle])

  // Another flight request, or the focus moving on, cancels a toggle still settling. Only a station flight, with the
  // station panel in front from then on, lets that station's panel resize reframe it.
  useEffect(() => {
    collapse.current = null
    flown.current = flyRequest?.kind === 'station' && front.current ? flyRequest.stationId : null
  }, [flyRequest, collapse])
  useEffect(() => {
    if (!stationFront) flown.current = null
  }, [stationFront])
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
