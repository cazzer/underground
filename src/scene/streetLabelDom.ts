/** The DOM of one drawn station's street and entrance labels (o3r.6): an aria-hidden wrapper div in the canvas's
 *  container holding a div per label, sized here and moved by the shared placement. */
import type { StreetLayer } from '../data/useStationStreets'
import { theme } from '../theme'
import type { LabelPlacement } from './labelPlacementState'
import { LABEL_HALO } from './useLevelLabels'

const WRAPPER_CLASS = 'pointer-events-none absolute inset-0'
const BASE = 'absolute top-0 left-0 font-mono text-[10px]'
// Streets uppercase and dim but not letter-spaced (that is the level labels' look); the focused station's entrances
// in normal case and full ink, as places to walk to, on two lines on a phone; a station beside it dims its own.
const STREET_CLASS = `${BASE} whitespace-nowrap text-ink-dim uppercase ${LABEL_HALO}`
const ENTRANCE_CLASS = `${BASE} whitespace-pre text-ink ${LABEL_HALO}`
const NEIGHBOUR_ENTRANCE_CLASS = `${BASE} whitespace-pre text-ink-dim ${LABEL_HALO}`
const EPS = 0.01

export interface StationLabelDom {
  layer: StreetLayer
  /** Holds every label of the station: its opacity and visibility fade them all at once. */
  wrapper: HTMLDivElement
  /** The entrances' labels, then the streets'. */
  els: HTMLDivElement[]
  /** Measured sizes, px, and line count, per label (copied into each placement). */
  w: Float32Array
  h: Float32Array
  lines: Uint8Array
  /** What was last written per label, so a frame only touches what changed. */
  x: Float32Array
  y: Float32Array
  turn: Float32Array
  shown: Uint8Array
  opacity: number
  /** The entrances are in full ink (the focused station's, or any with none focused); else dim. */
  focused: boolean
  /** The entrance label element tinted as the trip's exit, or null. */
  tinted: HTMLDivElement | null
}

function makeLabel(wrapper: HTMLDivElement, text: string, className: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  el.style.visibility = 'hidden'
  el.textContent = text
  wrapper.appendChild(el)
  return el
}

/** The station's wrapper and labels in `host` (z-index 0, under the HUD), hidden until shown; not yet measured. */
export function createStationDom(host: HTMLElement, layer: StreetLayer): StationLabelDom {
  const wrapper = document.createElement('div')
  wrapper.className = WRAPPER_CLASS
  wrapper.style.zIndex = '0'
  wrapper.style.visibility = 'hidden'
  wrapper.setAttribute('aria-hidden', 'true')
  const els = [
    ...layer.entrances.map((e) => makeLabel(wrapper, e.text, NEIGHBOUR_ENTRANCE_CLASS)),
    ...layer.streets.map((s) => makeLabel(wrapper, s.text, STREET_CLASS)),
  ]
  host.appendChild(wrapper)
  const n = els.length
  return {
    layer,
    wrapper,
    els,
    w: new Float32Array(n),
    h: new Float32Array(n),
    lines: new Uint8Array(n).fill(1),
    x: new Float32Array(n).fill(NaN),
    y: new Float32Array(n).fill(NaN),
    turn: new Float32Array(n).fill(NaN),
    shown: new Uint8Array(n),
    opacity: NaN,
    focused: false,
    tinted: null,
  }
}

/** Sizes every station's labels, entrances on two lines on a phone; one layout (all writes, then all reads). */
export function measureStations(doms: readonly StationLabelDom[], phone: boolean): void {
  for (const d of doms) {
    d.layer.entrances.forEach((e, i) => {
      const two = phone && e.tail !== ''
      d.els[i]!.textContent = two ? `${e.head}\n${e.tail}` : e.text
      d.lines[i] = two ? 2 : 1
    })
  }
  for (const d of doms) {
    for (let i = 0; i < d.els.length; i++) {
      d.w[i] = d.els[i]!.offsetWidth
      d.h[i] = d.els[i]!.offsetHeight
    }
  }
}

/** Copies the station's measured sizes into placement segment `s`. */
export function copySizes(p: LabelPlacement, d: StationLabelDom, s: number): void {
  const at = p.segItem0[s]!
  p.w.set(d.w, at)
  p.h.set(d.h, at)
  p.lines.set(d.lines, at)
}

/** The entrances in full ink, or dim (a station beside the focused one). */
export function setFocusedTone(d: StationLabelDom, focused: boolean): void {
  if (d.focused === focused) return
  d.focused = focused
  for (let i = 0; i < d.layer.entrances.length; i++) d.els[i]!.className = focused ? ENTRANCE_CLASS : NEIGHBOUR_ENTRANCE_CLASS
}

/** Writes each of segment `s`'s labels' place and visibility from the last placement, touching only what changed. A
 *  placed label inherits the wrapper's visibility; an unplaced one is hidden. */
export function writeStationLabels(d: StationLabelDom, p: LabelPlacement, s: number): void {
  const first = p.segItem0[s]!
  const entrances = d.layer.entrances.length
  for (let i = 0; i < d.els.length; i++) {
    const el = d.els[i]!
    const k = p.out[first + i]!
    const show = k >= 0 ? 1 : 0
    if (show !== d.shown[i]) {
      el.style.visibility = show ? 'inherit' : 'hidden'
      d.shown[i] = show
    }
    if (!show) continue
    const box = p.cand.start[first + i]! + k
    const x = p.cx[box]!
    const y = p.cy[box]!
    const turn = p.angle[box]!
    if (Math.abs(x - d.x[i]!) <= EPS && Math.abs(y - d.y[i]!) <= EPS && Math.abs(turn - d.turn[i]!) <= 1e-4) continue
    const at = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`
    el.style.transform = i < entrances ? at : `${at} rotate(${turn}rad)`
    d.x[i] = x
    d.y[i] = y
    d.turn[i] = turn
  }
}

/** Tints the station's label for street-file entrance `entrance` (the trip's exit; -1 for none) in the exit path's
 *  color (`theme.exitPath`), and only it. */
export function tintExit(d: StationLabelDom, entrance: number): void {
  const row = entrance < 0 ? -1 : d.layer.entrances.findIndex((e) => e.members.includes(entrance))
  const el = row >= 0 ? d.els[row]! : null
  if (el === d.tinted) return
  if (d.tinted) d.tinted.style.color = ''
  if (el) el.style.color = theme.exitPath
  d.tinted = el
}

/** Fades the station's labels to `o` (hidden at 0); only a change touches the DOM. */
export function setStationOpacity(d: StationLabelDom, o: number): void {
  if (o === d.opacity) return
  d.wrapper.style.opacity = String(o)
  if ((o > 0) !== (d.opacity > 0)) d.wrapper.style.visibility = o > 0 ? 'visible' : 'hidden'
  d.opacity = o
}

export function disposeStationDom(d: StationLabelDom): void {
  d.wrapper.remove()
}
