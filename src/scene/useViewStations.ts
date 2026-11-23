/**
 * Chooses the stations in view each time the view settles (o3r.2), for the scene to reveal; nothing consumes the
 * set yet but a dev probe. Read-only toward the camera: its frame runs at priority 0, after CameraRig, drei's
 * update and the follow have moved it, and allocates nothing per frame (the id list is built once per change).
 *
 * Privacy: the inputs are the camera, the free rect and the focused station, never the location fix or the nearest
 * station, and while the location cap (o3r.1) is in force nothing is chosen and the set is empty, the focused
 * station included, so a view fetch can never name the station a location flight landed on.
 *
 * Gating: `reselectDue` supplies the timing (held still 150 ms, or at most every 500 ms while moving); what counts as
 * changed enough is this view's own `viewMovedEnough` (a pan of 2% of the distance, a 3% zoom, a 3 degree turn, a
 * resize), since the tiles' 10% pan is over 100 px, far too coarse for a free-rect edge. A dirty flag forces a choice on
 * a free-rect change, a focus change, a change of `gateZone` (crossing REVEAL_FAR or its keep distance) and every frame
 * the cap is on, so the first frame after it lifts chooses. Flights are evaluated like any other movement. The store
 * (`lib/viewStationSet.ts`, created in Scene) is written only when the members change, or the first slot (the focused
 * station) does, compared with what was last written; it is emptied on unmount.
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import { markSelected, newPose, newReselect, reselectDue } from '../lib/basemap/reselect'
import type { LocationCap } from '../lib/basemap/locationCapHandle'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import type { ToScreen } from '../lib/pick'
import type { ViewStationSet } from '../lib/viewStationSet'
import {
  chooseViewStations,
  gateZone,
  MAX_VIEW_STATIONS,
  newViewScratch,
  sameMembers,
  viewMovedEnough,
  viewStationSpace,
  type ViewQuery,
} from '../lib/viewStations'
import type { MapControlsImpl } from './cameraFlight'

export interface ViewStationsOptions {
  network: Network
  insets: Insets
  /** The station panel's screen rect, as CameraRig gets it. */
  panel: ScreenRect | null
  cap: LocationCap
  /** Written with the station leads in view, focused first, each time the set changes (and with none under the cap). */
  set: ViewStationSet
}

const NO_IDS: readonly string[] = []

export function useViewStations({ network, insets, panel, cap, set }: ViewStationsOptions): void {
  const space = useMemo(() => viewStationSpace(network.stationGroups, network.stationById), [network])
  const size = useThree((s) => s.size)
  const { focusedId } = useFocus()
  const free = useMemo(() => interiorFreeRect(size, insets, panel), [size, insets, panel])

  const run = useMemo(() => {
    const vec = new Vector3()
    const view = { width: 1, height: 1, camera: null as Camera | null }
    // Projects through the camera of the frame being chosen for; set by the frame before each choice.
    const toScreen: ToScreen = (x, y, z, out) => {
      if (!view.camera) return false
      vec.set(x, y, z).project(view.camera)
      if (vec.z < -1 || vec.z > 1) return false
      out.x = ((vec.x + 1) / 2) * view.width
      out.y = ((1 - vec.y) / 2) * view.height
      return true
    }
    const query: ViewQuery = {
      distance: 0,
      tx: 0,
      tz: 0,
      free: { left: 0, top: 0, right: 0, bottom: 0 },
      toScreen,
      focused: -1,
      previous: new Int32Array(MAX_VIEW_STATIONS),
      previousCount: 0,
    }
    return {
      scratch: newViewScratch(space),
      pose: newPose(),
      reselect: newReselect(),
      chosen: query.previous,
      next: new Int32Array(MAX_VIEW_STATIONS),
      chosenCount: 0,
      /** What the store was last given (indices), apart from `chosen`, which every choice overwrites for the hysteresis. */
      published: new Int32Array(MAX_VIEW_STATIONS),
      publishedCount: 0,
      zone: 2 as 0 | 1 | 2,
      dirty: true,
      view,
      query,
    }
  }, [space])

  // Leaves the store empty when the scene goes or the space is rebuilt, so nothing reads stale ids.
  useEffect(
    () => () => {
      run.publishedCount = 0
      if (set.get().length > 0) set.set(NO_IDS)
    },
    [run, set],
  )
  useEffect(() => {
    run.query.free = free
    run.dirty = true
  }, [run, free])
  useEffect(() => {
    run.query.focused = focusedId === null ? -1 : (space.indexOf.get(focusedId) ?? -1)
    run.dirty = true
  }, [run, space, focusedId])

  useFrame((state) => {
    const c = state.controls as MapControlsImpl | null
    if (!c) return
    const p = run.pose
    p.tx = c.target.x
    p.tz = c.target.z
    p.distance = state.camera.position.distanceTo(c.target)
    p.azimuth = c.getAzimuthalAngle()
    p.width = state.size.width
    p.height = state.size.height
    const now = performance.now()
    const zone = gateZone(p.distance)
    if (zone !== run.zone) {
      run.zone = zone
      run.dirty = true
    }
    if (cap.isCapped()) {
      reselectDue(run.reselect, p, now)
      run.chosenCount = 0
      run.publishedCount = 0
      run.dirty = true
      if (set.get().length > 0) set.set(NO_IDS)
      return
    }
    // The tiles' own "meaningful change" is too coarse here (a 10% pan is over 100 px), so this view's test goes in as `slidOut`.
    const sel = run.reselect.selected
    if (!reselectDue(run.reselect, p, now, run.dirty || (sel !== null && viewMovedEnough(sel, p)))) return
    const q = run.query
    q.distance = p.distance
    q.tx = p.tx
    q.tz = p.tz
    q.previousCount = run.chosenCount
    run.view.width = state.size.width
    run.view.height = state.size.height
    run.view.camera = state.camera
    // CameraRig and the follow moved the camera this frame, after r3f last refreshed its matrices.
    state.camera.updateMatrixWorld()
    const n = chooseViewStations(space, q, run.scratch, run.next)
    run.dirty = false
    markSelected(run.reselect, p, now)
    for (let i = 0; i < n; i++) run.chosen[i] = run.next[i]!
    run.chosenCount = n
    // Against what was published, not the last choice, so a drift of unpublished choices never hides a change.
    const same = sameMembers(run.next, n, run.published, run.publishedCount, q.focused >= 0)
    // The store's own length too: another run's cleanup may have emptied it after this run last published.
    if (same && set.get().length === n) return
    const ids: string[] = []
    for (let i = 0; i < n; i++) {
      run.published[i] = run.next[i]!
      ids.push(space.ids[run.next[i]!]!)
    }
    run.publishedCount = n
    set.set(ids)
  }, 0)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, viewStations: () => set.get() }
    return () => {
      if (window.__underground) delete window.__underground.viewStations
    }
  }, [set])
}
