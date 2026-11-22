import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type RefObject } from 'react'
import { Matrix4, Vector3 } from 'three'
import type { StreetLayer } from '../data/useStationStreets'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import type { LabelBlockers } from '../lib/labelBlockers'
import type { Ground } from '../lib/projection'
import { isPhoneViewport, streetLabelRadiusM } from '../lib/streetLabelReveal'
import type { InteriorModel } from './interiorModel'
import { createLabelPlacement, newView, type LabelPlacement, type PlacementView } from './labelPlacementState'
import { placeLabels } from './streetLabelPlacement'
import { LABEL_HALO } from './useLevelLabels'

const WRAPPER_CLASS = 'pointer-events-none absolute inset-0'
const BASE = 'absolute top-0 left-0 font-mono text-[10px]'
// Streets uppercase and dim but not letter-spaced (that is the level labels' look); entrances in normal case and
// full ink, as places to walk to, on two lines on a phone.
const STREET_CLASS = `${BASE} whitespace-nowrap text-ink-dim uppercase ${LABEL_HALO}`
const ENTRANCE_CLASS = `${BASE} whitespace-pre text-ink ${LABEL_HALO}`
/** Frames without a change before the labels are placed once more from scratch (the view has settled). */
const SETTLE_FRAMES = 10
const EPS = 0.01

const a = new Vector3()
const b = new Vector3()

/** What the street layer knows that the labels need, written by its frame: the interior (null when there is none),
 *  the focused station's point while it draws a focus ring, the interior group's y scale, and the station markers'
 *  and focus ring's radius as drawn at this distance (meters). */
export interface LabelContext {
  interior: InteriorModel | null
  focusRing: Ground | null
  depthScale: number
  markerRadiusM: number
  ringRadiusM: number
}

interface LabelDom {
  host: HTMLElement
  /** Holds every label: its opacity and visibility fade them all at once. */
  wrapper: HTMLDivElement
  els: HTMLDivElement[]
  place: LabelPlacement
  /** What was last written per label, so a frame only touches what changed. */
  x: Float32Array
  y: Float32Array
  turn: Float32Array
  shown: Uint8Array
  opacity: number
  /** Inputs of the last placement; `dirty` forces the next one (a remeasure, or labels shown again). */
  cam: Matrix4
  proj: Matrix4
  insets: Insets | null
  levelsVersion: number
  dirty: boolean
  /** Whether the entrances are measured on two lines (a phone-sized canvas). */
  phone: boolean
  /** Frames since the inputs last changed; the settled re-place runs once at SETTLE_FRAMES. */
  still: number
  /** The last placement's view; reused, written field by field, never reallocated. */
  view: PlacementView
}

/** Sizes every label, entrances on two lines on a phone; one layout (all writes, then all reads). */
function measure(dom: LabelDom): void {
  const phone = isPhoneViewport({ width: dom.host.clientWidth, height: dom.host.clientHeight })
  dom.phone = phone
  dom.place.entrances.forEach((e, i) => {
    const two = phone && e.tail !== ''
    dom.els[i]!.textContent = two ? `${e.head}\n${e.tail}` : e.text
    dom.place.lines[i] = two ? 2 : 1
  })
  for (let i = 0; i < dom.els.length; i++) {
    dom.place.w[i] = dom.els[i]!.offsetWidth
    dom.place.h[i] = dom.els[i]!.offsetHeight
  }
  dom.dirty = true
}

/** Writes each label's place and visibility from the last placement, touching only what changed. A placed label
 *  inherits the wrapper's visibility; an unplaced one is hidden. */
function writeLabels(dom: LabelDom): void {
  const p = dom.place
  const entrances = p.entrances.length
  for (let i = 0; i < dom.els.length; i++) {
    const el = dom.els[i]!
    const k = p.out[i]!
    const show = k >= 0 ? 1 : 0
    if (show !== dom.shown[i]) {
      el.style.visibility = show ? 'inherit' : 'hidden'
      dom.shown[i] = show
    }
    if (!show) continue
    const box = p.cand.start[i]! + k
    const x = p.cx[box]!
    const y = p.cy[box]!
    const turn = p.angle[box]!
    if (Math.abs(x - dom.x[i]!) <= EPS && Math.abs(y - dom.y[i]!) <= EPS && Math.abs(turn - dom.turn[i]!) <= 1e-4) continue
    const at = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`
    el.style.transform = i < entrances ? at : `${at} rotate(${turn}rad)`
    dom.x[i] = x
    dom.y[i] = y
    dom.turn[i] = turn
  }
}

function makeLabel(wrapper: HTMLDivElement, text: string, className: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  el.style.visibility = 'hidden'
  el.textContent = text
  wrapper.appendChild(el)
  return el
}

/** The view's inputs changed since the last placement (the camera, canvas, insets, panel, level labels, interior or
 *  focus ring); copies them into the view when they did. */
function viewChanged(d: LabelDom, camera: PlacementView['camera'], size: { width: number; height: number; left: number; top: number }, ins: Insets, pan: ScreenRect | null, ctx: LabelContext, levels: LabelBlockers): boolean {
  const v = d.view
  const moved =
    d.dirty ||
    !d.cam.equals(camera.matrixWorld) ||
    !d.proj.equals(camera.projectionMatrix) ||
    v.width !== size.width ||
    v.height !== size.height ||
    v.left !== size.left ||
    v.top !== size.top ||
    d.insets !== ins ||
    v.panel !== pan ||
    v.interior !== ctx.interior ||
    v.focusRing !== ctx.focusRing ||
    d.levelsVersion !== levels.version
  if (!moved) return false
  d.dirty = false
  d.cam.copy(camera.matrixWorld)
  d.proj.copy(camera.projectionMatrix)
  d.insets = ins
  d.levelsVersion = levels.version
  v.width = size.width
  v.height = size.height
  v.left = size.left
  v.top = size.top
  v.insetTop = ins.top
  v.insetBottom = ins.bottom
  v.panel = pan
  v.interior = ctx.interior
  v.focusRing = ctx.focusRing
  v.depthScale = ctx.depthScale
  v.markerRadiusM = ctx.markerRadiusM
  v.ringRadiusM = ctx.ringRadiusM
  v.radiusM = streetLabelRadiusM(size)
  return true
}

/**
 * The focused station's street and entrance labels: one aria-hidden wrapper div in the canvas's container (z-index
 * 0, under the HUD) holding a div per label, as the level labels are placed (useLevelLabels.ts). Sized after mount,
 * after the fonts load and when a resize flips between phone and desktop sizes. On a frame where the view's inputs or the opacity changed, the candidates are
 * projected and decluttered (streetLabelPlacement.ts), and once more from scratch when the view has held still for
 * SETTLE_FRAMES; nothing else touches the DOM. `levels` is read a frame late. `opacity` and `context` are read every
 * frame (opacity 0 hides them all). Register it after the frame that writes them.
 */
export function useStreetLabels(
  layer: StreetLayer,
  stations: readonly Ground[],
  bundles: readonly (readonly Float32Array[])[],
  opacity: RefObject<number>,
  context: RefObject<LabelContext>,
  insets: RefObject<Insets>,
  panel: RefObject<ScreenRect | null>,
  levels: LabelBlockers,
  markHalfM: number,
): void {
  const host = useThree((s) => s.gl.domElement.parentElement)
  const camera = useThree((s) => s.camera)
  const dom = useRef<LabelDom | null>(null)

  useEffect(() => {
    if (!host) return
    // Only the first 32 entrances can ignore a station marker over their own mark (one exemption bit each, in a
    // Uint32 per rect; labelDeclutter.ts). The rest still place, just blocked by such a marker.
    if (import.meta.env.DEV && layer.entrances.length > 32) {
      console.warn(`Street labels: station ${layer.stationId} has ${layer.entrances.length} entrance labels; marker exemptions cover 32`)
    }
    const wrapper = document.createElement('div')
    wrapper.className = WRAPPER_CLASS
    wrapper.style.zIndex = '0'
    wrapper.style.visibility = 'hidden'
    wrapper.setAttribute('aria-hidden', 'true')
    const els = [
      ...layer.entrances.map((e) => makeLabel(wrapper, e.text, ENTRANCE_CLASS)),
      ...layer.streets.map((s) => makeLabel(wrapper, s.text, STREET_CLASS)),
    ]
    host.appendChild(wrapper)
    const n = els.length
    const state: LabelDom = {
      host,
      wrapper,
      els,
      place: createLabelPlacement(layer.entrances, layer.streets, layer.marks, stations, bundles),
      x: new Float32Array(n).fill(NaN),
      y: new Float32Array(n).fill(NaN),
      turn: new Float32Array(n).fill(NaN),
      shown: new Uint8Array(n),
      opacity: NaN,
      cam: new Matrix4(),
      proj: new Matrix4(),
      insets: null,
      levelsVersion: NaN,
      dirty: true,
      phone: false,
      still: 0,
      view: newView(camera, markHalfM),
    }
    measure(state)
    dom.current = state
    let live = true
    // A web font arriving later, or a phone turning, changes the sizes (and a phone's entrance lines).
    document.fonts.ready.then(
      () => {
        if (live) measure(state)
      },
      (err: unknown) => console.error('Street labels: waiting for fonts failed', err),
    )
    // Text only reflows when a phone-sized canvas turns desktop-sized or back.
    const onResize = () => {
      if (isPhoneViewport({ width: host.clientWidth, height: host.clientHeight }) !== state.phone) measure(state)
    }
    window.addEventListener('resize', onResize)
    return () => {
      live = false
      window.removeEventListener('resize', onResize)
      wrapper.remove()
      dom.current = null
    }
  }, [host, camera, layer, stations, bundles, markHalfM])

  useFrame(({ size }) => {
    const d = dom.current
    if (!d) return
    const o = opacity.current
    if (o !== d.opacity) {
      d.wrapper.style.opacity = String(o)
      if ((o > 0) !== (d.opacity > 0)) d.wrapper.style.visibility = o > 0 ? 'visible' : 'hidden'
      d.opacity = o
    }
    if (!(o > 0)) {
      d.dirty = true
      return
    }
    camera.updateMatrixWorld()
    if (viewChanged(d, camera, size, insets.current, panel.current, context.current, levels)) d.still = 0
    else if (++d.still !== SETTLE_FRAMES) return
    d.view.fresh = d.still === SETTLE_FRAMES
    placeLabels(d.place, layer.anchor, d.view, levels, a, b)
    writeLabels(d)
  })
}
