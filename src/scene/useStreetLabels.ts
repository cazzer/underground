import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, type RefObject } from 'react'
import { Matrix4, Vector3 } from 'three'
import type { StreetLayer } from '../data/useStationStreets'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { streetLabelRadiusM } from '../lib/streetLabelReveal'
import { createLabelPlacement, placeLabels, type LabelPlacement, type PlacementView } from './streetLabelPlacement'
import { LABEL_HALO } from './useLevelLabels'

const BASE = 'pointer-events-none absolute top-0 left-0 font-mono text-[10px] whitespace-nowrap'
// Streets read like the level labels; entrances in normal case and full ink, as places to walk to.
const STREET_CLASS = `${BASE} text-ink-dim uppercase tracking-widest ${LABEL_HALO}`
const ENTRANCE_CLASS = `${BASE} text-ink ${LABEL_HALO}`
/** Labels keep this far clear of the station panel, px. */
const PANEL_PAD_PX = 8
const EPS = 0.01

const a = new Vector3()
const b = new Vector3()

interface LabelDom {
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
  dirty: boolean
  /** The last placement's view (canvas, insets, panel); reused, written field by field, never reallocated. */
  view: PlacementView
}

function measure(dom: LabelDom): void {
  // Read every size in one pass after the writes, so it is one layout.
  dom.els.forEach((el, i) => {
    dom.place.w[i] = el.offsetWidth
    dom.place.h[i] = el.offsetHeight
  })
  dom.dirty = true
}

function hideAll(dom: LabelDom): void {
  for (let i = 0; i < dom.els.length; i++) {
    if (dom.shown[i] === 0) continue
    dom.els[i]!.style.visibility = 'hidden'
    dom.shown[i] = 0
  }
}

/** Writes each label's place and visibility from the last placement, touching only what changed. */
function writeLabels(dom: LabelDom): void {
  const p = dom.place
  const entrances = p.entrances.length
  for (let i = 0; i < dom.els.length; i++) {
    const el = dom.els[i]!
    const k = p.out[i]!
    const show = k >= 0 ? 1 : 0
    if (show !== dom.shown[i]) {
      el.style.visibility = show ? 'visible' : 'hidden'
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

/**
 * The focused station's street and entrance labels: aria-hidden DOM divs in the canvas's container (z-index 0, under
 * the HUD), as the level labels are (useLevelLabels.ts). Sized once after mount and again once the fonts load. Each
 * frame where the camera, canvas, insets, panel or opacity changed, the candidates are projected and decluttered
 * (entrances first, then streets, longest first), keeping clear of the header, footer and panel; nothing else
 * touches the DOM. `opacity` is read every frame (0 hides them all). Register it after the frame that writes it.
 */
export function useStreetLabels(
  layer: StreetLayer,
  opacity: RefObject<number>,
  insets: RefObject<Insets>,
  panel: RefObject<ScreenRect | null>,
  markHalfM: number,
): void {
  const host = useThree((s) => s.gl.domElement.parentElement)
  const camera = useThree((s) => s.camera)
  const dom = useRef<LabelDom | null>(null)

  useEffect(() => {
    if (!host) return
    const texts = [
      ...layer.entrances.map((e) => ({ text: e.text, cls: ENTRANCE_CLASS })),
      ...layer.streets.map((s) => ({ text: s.text, cls: STREET_CLASS })),
    ]
    const els = texts.map(({ text, cls }) => {
      const el = document.createElement('div')
      el.className = cls
      el.style.zIndex = '0'
      el.style.visibility = 'hidden'
      el.setAttribute('aria-hidden', 'true')
      el.textContent = text
      host.appendChild(el)
      return el
    })
    const n = els.length
    const state: LabelDom = {
      els,
      place: createLabelPlacement(layer.entrances, layer.streets),
      x: new Float32Array(n).fill(NaN),
      y: new Float32Array(n).fill(NaN),
      turn: new Float32Array(n).fill(NaN),
      shown: new Uint8Array(n),
      opacity: NaN,
      cam: new Matrix4(),
      proj: new Matrix4(),
      insets: null,
      dirty: true,
      view: {
        camera,
        width: 0,
        height: 0,
        left: 0,
        top: 0,
        insetTop: 0,
        insetBottom: 0,
        panel: null,
        panelPad: PANEL_PAD_PX,
        radiusM: 0,
        markHalfM,
      },
    }
    measure(state)
    dom.current = state
    let live = true
    // A web font arriving later changes every width.
    document.fonts.ready.then(
      () => {
        if (live) measure(state)
      },
      (err: unknown) => console.error('Street labels: waiting for fonts failed', err),
    )
    return () => {
      live = false
      for (const el of els) el.remove()
      dom.current = null
    }
  }, [host, camera, layer, markHalfM])

  useFrame(({ size }) => {
    const d = dom.current
    if (!d) return
    const o = opacity.current
    if (o !== d.opacity) {
      for (const el of d.els) el.style.opacity = String(o)
      d.opacity = o
    }
    if (!(o > 0)) {
      hideAll(d)
      d.dirty = true
      return
    }
    camera.updateMatrixWorld()
    const { view } = d
    const ins = insets.current
    const pan = panel.current
    const moved =
      d.dirty ||
      !d.cam.equals(camera.matrixWorld) ||
      !d.proj.equals(camera.projectionMatrix) ||
      view.width !== size.width ||
      view.height !== size.height ||
      view.left !== size.left ||
      view.top !== size.top ||
      d.insets !== ins ||
      view.panel !== pan
    if (!moved) return
    d.dirty = false
    d.cam.copy(camera.matrixWorld)
    d.proj.copy(camera.projectionMatrix)
    d.insets = ins
    view.width = size.width
    view.height = size.height
    view.left = size.left
    view.top = size.top
    view.insetTop = ins.top
    view.insetBottom = ins.bottom
    view.panel = pan
    view.radiusM = streetLabelRadiusM(size)
    placeLabels(d.place, layer.anchor, view, a, b)
    writeLabels(d)
  })
}

