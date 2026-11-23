/**
 * Chooses the stations in view each time the view settles (o3r.2), for the scene to reveal (o3r.4, o3r.5), and the wider
 * set to prefetch (o3r.8). Read-only toward the camera: its frame runs at priority 0, after CameraRig, drei's update and
 * the follow have moved it, and allocates nothing per frame (the id list is built once per change). The rules of the
 * frame are `stepViewChoice` (`lib/viewStationsRun.ts`, pure and tested); this hook feeds it the camera, the free rect,
 * the focus and the cap, and points its projection at the frame's camera.
 *
 * Privacy: the inputs are the camera, the free rect and the focused station, never the location fix or the nearest
 * station, and while the location cap (o3r.1) is in force nothing is chosen and both sets are empty, the focused
 * station included, so a view or prefetch fetch can never name the station a location flight landed on.
 *
 * Gating: `reselectDue` supplies the timing (held still 150 ms, or at most every 500 ms while moving); what counts as
 * changed enough is this view's own `viewMovedEnough` (a pan of 2% of the distance, a 3% zoom, a 3 degree turn, a
 * resize), since the tiles' 10% pan is over 100 px, far too coarse for a free-rect edge. A dirty flag forces a choice on
 * a free-rect change, a focus change and every frame the cap is on, so the first frame after it lifts chooses.
 * Crossing a gate zone (`viewZones`: REVEAL_FAR, PREFETCH_FAR and their keep distances) chooses on that frame whatever
 * the timing says, both ways, so a quick zoom neither waits 500 ms to start nor to stop. Flights are evaluated like any
 * other movement. Each store (`lib/viewStationSet.ts`, created in Scene) is written only when the members change, or the
 * first slot (the focused station, view set only) does, compared with what was last written; both are emptied on unmount.
 *
 * Each choice also runs a wider one for the prefetch: same ranking and free-rect test, out to PREFETCH_FAR,
 * MAX_PREFETCH_STATIONS stations, no focused head, its own hysteresis, into `prefetch` (a second store that only
 * StationPrefetchSource reads, so its changes never re-render Scene).
 */
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { type Camera, Vector3 } from 'three'
import type { LocationCap } from '../lib/basemap/locationCapHandle'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import { interiorFreeRect, type ScreenRect } from '../lib/interiorCamera'
import type { Network } from '../lib/network'
import type { ToScreen } from '../lib/pick'
import type { ViewStationSet } from '../lib/viewStationSet'
import { viewStationSpace } from '../lib/viewStations'
import { emptyViewRun, newViewRun, stepViewChoice } from '../lib/viewStationsRun'
import type { MapControlsImpl } from './cameraFlight'

export interface ViewStationsOptions {
  network: Network
  insets: Insets
  /** The station panel's screen rect, as CameraRig gets it. */
  panel: ScreenRect | null
  cap: LocationCap
  /** Written with the station leads in view, focused first, each time the set changes (and with none under the cap). */
  set: ViewStationSet
  /** Written the same way with the wider prefetch choice (o3r.8): nothing draws from it. */
  prefetch: ViewStationSet
}

export function useViewStations({ network, insets, panel, cap, set, prefetch }: ViewStationsOptions): void {
  const space = useMemo(() => viewStationSpace(network.stationGroups, network.stationById), [network])
  const size = useThree((s) => s.size)
  const { focusedId } = useFocus()
  const free = useMemo(() => interiorFreeRect(size, insets, panel), [size, insets, panel])

  const { run, view, prepare } = useMemo(() => {
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
    // One function for the run's life, so a frame allocates nothing: it reads the camera the frame stored in `view`.
    const prepare = (): void => {
      view.camera?.updateMatrixWorld()
    }
    return { run: newViewRun(space, toScreen), view, prepare }
  }, [space])

  // Leaves both stores empty when the scene goes or the space is rebuilt, so nothing reads stale ids.
  useEffect(() => () => emptyViewRun(run, set, prefetch), [run, set, prefetch])
  useEffect(() => {
    run.query.free = free
    run.pquery.free = free
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
    view.width = state.size.width
    view.height = state.size.height
    // CameraRig and the follow moved the camera this frame, after r3f last refreshed its matrices: `prepare` refreshes them.
    view.camera = state.camera
    stepViewChoice(run, cap.isCapped(), performance.now(), prepare, set, prefetch)
  }, 0)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__underground = { ...window.__underground, viewStations: () => set.get(), prefetchStations: () => prefetch.get() }
    return () => {
      if (window.__underground) {
        delete window.__underground.viewStations
        delete window.__underground.prefetchStations
      }
    }
  }, [set, prefetch])
}
