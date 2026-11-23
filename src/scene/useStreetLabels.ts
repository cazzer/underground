import { useFrame, useThree } from '@react-three/fiber'
import { useLayoutEffect, useRef, type RefObject } from 'react'
import { Matrix4, Vector3 } from 'three'
import type { StreetLayer } from '../data/useStationStreets'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Ground } from '../lib/projection'
import { isPhoneViewport, neighbourLabelBudget, streetLabelRadiusM } from '../lib/streetLabelReveal'
import type { InteriorModel } from './interiorModel'
import { carryPlacement, createLabelPlacement } from './labelPlacementLayout'
import { newView, type LabelPlacement, type PlacementStation, type PlacementView } from './labelPlacementState'
import { copySizes, createStationDom, disposeStationDom, measureStations, setFocusedTone, setStationOpacity, tintExit, writeStationLabels, type StationLabelDom } from './streetLabelDom'
import { placeLabels } from './streetLabelPlacement'
import { installStreetLabelProbe, newTimings, recordTiming, type LabelTimings } from './streetLabelProbe'

/** Frames without a change before the labels are placed once more from scratch (the view has settled). */
const SETTLE_FRAMES = 10

const a = new Vector3()
const b = new Vector3()

/** A drawn station for the labels: its layer, its streets' subway bundles, and its layer's presence (its labels fade
 *  with it; null for always present). */
export interface LabelStation extends PlacementStation {
  presence: { readonly value: number } | null
}

/** What the street layers know that the labels need, written by StreetLabels' frame: every drawn interior, the
 *  focused station's point while it draws a focus ring, the interiors' y scale, and the station markers' and focus
 *  ring's radius as drawn at this distance (meters). */
export interface LabelContext {
  interiors: readonly InteriorModel[]
  focusRing: Ground | null
  depthScale: number
  markerRadiusM: number
  ringRadiusM: number
  /** The first station is the focused one (unbudgeted, its entrances in full ink, the trip's exit its own). */
  focusedFirst: boolean
  /** The focused station's street-file entrance index of the trip's exit (its label ranks first, tinted the path's
   *  color); -1 for none. */
  priorityEntrance: number
  /** Per nearby marker (the `nearby` passed in): 1 while its marker isn't drawn; null for all drawn. Bump
   *  `markersVersion` on any change, so the labels are placed again. */
  markerHidden: Uint8Array | null
  markersVersion: number
}

export interface LabelState {
  host: HTMLElement
  /** Every station's DOM by layer; `segs` in placement order. */
  doms: Map<StreetLayer, StationLabelDom>
  segs: StationLabelDom[]
  stations: readonly LabelStation[]
  place: LabelPlacement
  /** Inputs of the last placement; `dirty` forces the next one (a remeasure, a new set, or labels shown again). */
  cam: Matrix4
  proj: Matrix4
  insets: Insets | null
  levelsVersion: number
  markersVersion: number
  dirty: boolean
  /** The entrance tones and exit tint need writing (a new set, or the focus or exit changed). */
  tones: boolean
  /** Whether the entrances are measured on two lines (a phone-sized canvas). */
  phone: boolean
  /** Frames since the inputs last changed; the settled re-place runs once at SETTLE_FRAMES. */
  still: number
  /** The last placement's view; reused, written field by field, never reallocated. */
  view: PlacementView
  timings: LabelTimings
}

/** Measures every station's labels again (fonts arrived, or the canvas flipped phone and desktop). */
function remeasure(st: LabelState): void {
  st.phone = isPhoneViewport({ width: st.host.clientWidth, height: st.host.clientHeight })
  measureStations(st.segs, st.phone)
  for (let s = 0; s < st.segs.length; s++) copySizes(st.place, st.segs[s]!, s)
  st.dirty = true
}

function writeTones(st: LabelState): void {
  const v = st.view
  for (let s = 0; s < st.segs.length; s++) {
    const focused = s === 0 && v.focusedFirst
    setFocusedTone(st.segs[s]!, focused)
    tintExit(st.segs[s]!, focused ? v.priorityEntrance : -1)
  }
  st.tones = false
}

/** The view's inputs changed since the last placement (the camera, canvas, insets, panel, level labels, interiors,
 *  focus, focus ring or which station markers are drawn); copies them into the view when they did. */
function viewChanged(st: LabelState, camera: PlacementView['camera'], size: { width: number; height: number; left: number; top: number }, ins: Insets, pan: ScreenRect | null, ctx: LabelContext, levels: LabelBlockers): boolean {
  const v = st.view
  const moved =
    st.dirty ||
    !st.cam.equals(camera.matrixWorld) ||
    !st.proj.equals(camera.projectionMatrix) ||
    v.width !== size.width ||
    v.height !== size.height ||
    v.left !== size.left ||
    v.top !== size.top ||
    st.insets !== ins ||
    v.panel !== pan ||
    v.interiors !== ctx.interiors ||
    v.focusRing !== ctx.focusRing ||
    v.focusedFirst !== ctx.focusedFirst ||
    v.priorityEntrance !== ctx.priorityEntrance ||
    st.levelsVersion !== levels.version ||
    st.markersVersion !== ctx.markersVersion
  if (!moved) return false
  st.dirty = false
  st.cam.copy(camera.matrixWorld)
  st.proj.copy(camera.projectionMatrix)
  st.insets = ins
  st.levelsVersion = levels.version
  st.markersVersion = ctx.markersVersion
  v.markerHidden = ctx.markerHidden
  v.width = size.width
  v.height = size.height
  v.left = size.left
  v.top = size.top
  v.insetTop = ins.top
  v.insetBottom = ins.bottom
  v.panel = pan
  v.interiors = ctx.interiors
  v.focusRing = ctx.focusRing
  if (v.focusedFirst !== ctx.focusedFirst || v.priorityEntrance !== ctx.priorityEntrance) st.tones = true
  v.focusedFirst = ctx.focusedFirst
  v.priorityEntrance = ctx.priorityEntrance
  if (st.tones) writeTones(st)
  v.depthScale = ctx.depthScale
  v.markerRadiusM = ctx.markerRadiusM
  v.ringRadiusM = ctx.ringRadiusM
  v.radiusM = streetLabelRadiusM(size)
  const budget = neighbourLabelBudget(size)
  v.budgetEntrances = budget.entrances
  v.budgetStreets = budget.streets
  return true
}

/**
 * Every drawn station's street and entrance labels in one declutter pass (o3r.6; streetLabelPlacement.ts): per
 * station one aria-hidden wrapper div in the canvas's container (z-index 0, under the HUD) holding a div per label, as
 * the level labels are placed (useLevelLabels.ts), its opacity `opacity` times the station's presence. `stations` is
 * in label order (labelStationOrder.ts); a new set rebuilds the placement's arrays, creates and measures only the new
 * stations' divs, and carries every kept station's last picks over (by layer object), so it doesn't move their
 * labels. Sized after mount, after the fonts load and when a resize flips between phone and desktop sizes. On a frame
 * where the view's inputs changed the candidates are projected and decluttered, and once more from scratch when the
 * view has held still for SETTLE_FRAMES; nothing else touches the DOM. `levels` is read a frame late. `opacity` and
 * `context` are read every frame (opacity 0 hides them all). Register it after the frame that writes them.
 */
export function useStreetLabels(
  stations: readonly LabelStation[],
  nearby: readonly Ground[],
  opacity: RefObject<number>,
  context: RefObject<LabelContext>,
  insets: RefObject<Insets>,
  panel: RefObject<ScreenRect | null>,
  levels: LabelBlockers,
  markHalfM: number,
): void {
  const host = useThree((s) => s.gl.domElement.parentElement)
  const camera = useThree((s) => s.camera)
  const state = useRef<LabelState | null>(null)

  useLayoutEffect(() => {
    if (!host) return
    const st: LabelState = {
      host,
      doms: new Map(),
      segs: [],
      stations: [],
      place: createLabelPlacement([], []),
      cam: new Matrix4(),
      proj: new Matrix4(),
      insets: null,
      levelsVersion: NaN,
      markersVersion: NaN,
      dirty: true,
      tones: true,
      phone: isPhoneViewport({ width: host.clientWidth, height: host.clientHeight }),
      still: 0,
      view: newView(camera, markHalfM),
      timings: newTimings(),
    }
    state.current = st
    let live = true
    // A web font arriving later, or a phone turning, changes the sizes (and a phone's entrance lines).
    document.fonts.ready.then(
      () => {
        if (live) remeasure(st)
      },
      (err: unknown) => console.error('Street labels: waiting for fonts failed', err),
    )
    // Text only reflows when a phone-sized canvas turns desktop-sized or back.
    const onResize = () => {
      if (isPhoneViewport({ width: host.clientWidth, height: host.clientHeight }) !== st.phone) remeasure(st)
    }
    window.addEventListener('resize', onResize)
    const uninstall = installStreetLabelProbe(() => state.current)
    return () => {
      live = false
      window.removeEventListener('resize', onResize)
      uninstall()
      for (const d of st.doms.values()) disposeStationDom(d)
      state.current = null
    }
  }, [host, camera, markHalfM])

  useLayoutEffect(() => {
    const st = state.current
    if (!st) return
    const doms = new Map<StreetLayer, StationLabelDom>()
    const fresh: StationLabelDom[] = []
    for (const { layer } of stations) {
      let d = st.doms.get(layer)
      if (!d) {
        d = createStationDom(st.host, layer)
        fresh.push(d)
      }
      doms.set(layer, d)
    }
    for (const [layer, d] of st.doms) if (!doms.has(layer)) disposeStationDom(d)
    measureStations(fresh, st.phone)
    const place = createLabelPlacement(stations, nearby)
    carryPlacement(place, st.place)
    st.segs = stations.map((s) => doms.get(s.layer)!)
    st.segs.forEach((d, s) => copySizes(place, d, s))
    st.doms = doms
    st.stations = stations
    st.place = place
    st.dirty = true
    st.tones = true
  }, [host, camera, markHalfM, stations, nearby])

  useFrame(({ size }) => {
    const st = state.current
    if (!st) return
    const o = opacity.current
    let shown = false
    for (let s = 0; s < st.segs.length; s++) {
      const v = o * (st.stations[s]!.presence?.value ?? 1)
      setStationOpacity(st.segs[s]!, v)
      if (v > 0) shown = true
    }
    if (!shown) {
      st.dirty = true
      return
    }
    camera.updateMatrixWorld()
    if (viewChanged(st, camera, size, insets.current, panel.current, context.current, levels)) st.still = 0
    else if (++st.still !== SETTLE_FRAMES) return
    st.view.fresh = st.still === SETTLE_FRAMES
    const t0 = performance.now()
    placeLabels(st.place, st.view, levels, a, b)
    recordTiming(st.timings, performance.now() - t0)
    for (let s = 0; s < st.segs.length; s++) writeStationLabels(st.segs[s]!, st.place, s)
  })
}

