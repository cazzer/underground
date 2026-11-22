import type { Camera, Vector3 } from 'three'
import type { EntranceLabelSource } from '../data/useStationStreets'
import type { ScreenRect } from '../lib/interiorCamera'
import { declutter, type LabelBounds, type LabelCandidates } from '../lib/labelDeclutter'
import { BOX, uprightAngle, writeBox } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import type { LabelCandidate, StreetLabelSource } from '../lib/streetRuns'

/** Gap between an entrance mark's edge and its label, px. */
const MARK_GAP_PX = 6
/** Street labels turn along the street's screen direction over this many meters of it. */
const TANGENT_M = 5
/** Entrance candidates, in preference order: right, left, above, below the mark. */
const ENTRANCE_SIDES = 4

/** Typed arrays for one station's labels, sized once: items are its entrances (first), then its streets. */
export interface LabelPlacement {
  entrances: readonly EntranceLabelSource[]
  streets: readonly StreetLabelSource[]
  /** Measured label sizes, px, per item. */
  w: Float32Array
  h: Float32Array
  cand: LabelCandidates
  bounds: LabelBounds
  /** Per box: its screen center, its angle (radians), and for a street the candidate index in its run. */
  cx: Float32Array
  cy: Float32Array
  angle: Float32Array
  src: Int16Array
  /** Per item: this frame's run, last placement's run and candidate (-1 for none), the preference, the result. */
  run: Int16Array
  lastRun: Int16Array
  lastSrc: Int16Array
  prefer: Int16Array
  out: Int16Array
  /** Scratch: a street's on-screen candidate indices. */
  valid: Int16Array
}

const emptyRect = (): ScreenRect => ({ left: 0, top: 0, right: 0, bottom: 0 })

export function createLabelPlacement(entrances: readonly EntranceLabelSource[], streets: readonly StreetLabelSource[]): LabelPlacement {
  const n = entrances.length + streets.length
  let boxes = entrances.length * ENTRANCE_SIDES
  let longest = 0
  for (const s of streets) {
    const most = Math.max(...s.runs.map((r) => r.length))
    boxes += most
    longest = Math.max(longest, most)
  }
  const minus = (len: number) => new Int16Array(len).fill(-1)
  return {
    entrances,
    streets,
    w: new Float32Array(n),
    h: new Float32Array(n),
    cand: { boxes: new Float32Array(boxes * BOX), start: new Int32Array(n), size: new Int32Array(n), count: n },
    bounds: { viewport: emptyRect(), rects: [emptyRect(), emptyRect(), emptyRect()], count: 0 },
    cx: new Float32Array(boxes),
    cy: new Float32Array(boxes),
    angle: new Float32Array(boxes),
    src: new Int16Array(boxes),
    run: minus(n),
    lastRun: minus(n),
    lastSrc: minus(n),
    prefer: minus(n),
    out: minus(n),
    valid: new Int16Array(longest),
  }
}

function setRect(r: ScreenRect, left: number, top: number, right: number, bottom: number): void {
  r.left = left
  r.top = top
  r.right = right
  r.bottom = bottom
}

/** This frame's view: the camera, the canvas, and what covers it (header and footer bands; the panel, in client
 *  coordinates, kept `panelPad` px clear). */
export interface PlacementView {
  camera: Camera
  /** Canvas size and its offset in the page (r3f's size). */
  width: number
  height: number
  left: number
  top: number
  insetTop: number
  insetBottom: number
  panel: ScreenRect | null
  panelPad: number
  /** How far from the anchor a street label may sit, meters. */
  radiusM: number
  /** An entrance mark's half side, meters. */
  markHalfM: number
}

/** Projects world (x, 0, z) into canvas px in `v`; false when behind the camera or past its far plane. */
function toScreen(v: Vector3, x: number, z: number, view: PlacementView): boolean {
  v.set(x, 0, z).project(view.camera)
  if (!(Math.abs(v.z) < 1)) return false
  v.x = ((v.x + 1) * view.width) / 2
  v.y = ((1 - v.y) * view.height) / 2
  return true
}

function onScreen(v: Vector3, view: PlacementView): boolean {
  return v.x >= 0 && v.x <= view.width && v.y >= 0 && v.y <= view.height
}

function addBox(p: LabelPlacement, b: number, item: number, x: number, y: number, angle: number): void {
  writeBox(p.cand.boxes, b, x, y, p.w[item]!, p.h[item]!, angle)
  p.cx[b] = x
  p.cy[b] = y
  p.angle[b] = angle
}

/** An entrance's four candidates around its mark; returns the next free box. */
function entranceBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number): number {
  const e = p.entrances[i]!
  p.cand.start[i] = box
  p.cand.size[i] = 0
  p.prefer[i] = p.lastSrc[i]!
  const x = anchor.x + e.x
  const z = anchor.z + e.z
  if (!toScreen(a, x, z, view) || !onScreen(a, view) || !toScreen(b, x + view.markHalfM, z, view)) return box
  const half = Math.hypot(b.x - a.x, b.y - a.y)
  const dx = half + MARK_GAP_PX + p.w[i]! / 2
  const dy = half + MARK_GAP_PX + p.h[i]! / 2
  addBox(p, box, i, a.x + dx, a.y, 0)
  addBox(p, box + 1, i, a.x - dx, a.y, 0)
  addBox(p, box + 2, i, a.x, a.y - dy, 0)
  addBox(p, box + 3, i, a.x, a.y + dy, 0)
  p.cand.size[i] = ENTRANCE_SIDES
  return box + ENTRANCE_SIDES
}

/** A street's candidates: its run with the most candidates on screen within the radius, from that stretch's middle
 *  outward; returns the next free box. */
function streetBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number): number {
  const street = p.streets[i - p.entrances.length]!
  p.cand.start[i] = box
  p.cand.size[i] = 0
  p.prefer[i] = -1
  const r2 = view.radiusM * view.radiusM
  let best = -1
  let bestCount = 0
  for (let r = 0; r < street.runs.length; r++) {
    let count = 0
    for (const c of street.runs[r]!) {
      if (c.x * c.x + c.z * c.z <= r2 && toScreen(a, anchor.x + c.x, anchor.z + c.z, view) && onScreen(a, view)) count++
    }
    if (count > bestCount) {
      best = r
      bestCount = count
    }
  }
  p.run[i] = best
  if (best < 0) return box
  const run = street.runs[best]!
  let n = 0
  for (let k = 0; k < run.length; k++) {
    const c = run[k]!
    if (c.x * c.x + c.z * c.z <= r2 && toScreen(a, anchor.x + c.x, anchor.z + c.z, view) && onScreen(a, view)) p.valid[n++] = k
  }
  // The middle of the visible stretch first, then outward: mid, mid + 1, mid - 1, mid + 2, ...
  const mid = (n - 1) >> 1
  const start = box
  for (let d = 0; box - start < n; d++) {
    if (mid + d < n) box = streetBox(p, i, anchor, view, a, b, box, start, run[p.valid[mid + d]!]!, p.valid[mid + d]!)
    if (d > 0 && mid - d >= 0) box = streetBox(p, i, anchor, view, a, b, box, start, run[p.valid[mid - d]!]!, p.valid[mid - d]!)
  }
  p.cand.size[i] = n
  return box
}

/** One street candidate's box, turned along the street on screen; returns the next free box. */
function streetBox(
  p: LabelPlacement,
  i: number,
  anchor: Ground,
  view: PlacementView,
  a: Vector3,
  b: Vector3,
  box: number,
  start: number,
  c: LabelCandidate,
  k: number,
): number {
  toScreen(a, anchor.x + c.x, anchor.z + c.z, view)
  const ok = toScreen(b, anchor.x + c.x + c.tx * TANGENT_M, anchor.z + c.z + c.tz * TANGENT_M, view)
  addBox(p, box, i, a.x, a.y, ok ? uprightAngle(b.x - a.x, b.y - a.y) : 0)
  p.src[box] = k
  if (p.lastRun[i] === p.run[i] && p.lastSrc[i] === k) p.prefer[i] = box - start
  return box + 1
}

/** Builds every candidate for this view, declutters, and records the picks for next time. Allocation-free. */
export function placeLabels(p: LabelPlacement, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3): void {
  const { bounds } = p
  setRect(bounds.viewport, 0, 0, view.width, view.height)
  setRect(bounds.rects[0]!, 0, 0, view.width, view.insetTop)
  setRect(bounds.rects[1]!, 0, view.height - view.insetBottom, view.width, view.height)
  bounds.count = 2
  if (view.panel) {
    const pad = view.panelPad
    const q = view.panel
    setRect(bounds.rects[2]!, q.left - view.left - pad, q.top - view.top - pad, q.right - view.left + pad, q.bottom - view.top + pad)
    bounds.count = 3
  }
  const e = p.entrances.length
  let box = 0
  for (let i = 0; i < e; i++) box = entranceBoxes(p, i, anchor, view, a, b, box)
  for (let i = e; i < p.cand.count; i++) box = streetBoxes(p, i, anchor, view, a, b, box)
  declutter(p.cand, bounds, p.prefer, p.out)
  for (let i = 0; i < p.cand.count; i++) {
    const k = p.out[i]!
    p.lastRun[i] = i < e ? 0 : p.run[i]!
    p.lastSrc[i] = k < 0 ? -1 : i < e ? k : p.src[p.cand.start[i]! + k]!
  }
}
