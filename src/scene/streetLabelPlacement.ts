import type { Camera, Vector3 } from 'three'
import type { EntranceLabelSource } from '../data/useStationStreets'
import type { ScreenRect } from '../lib/interiorCamera'
import { MAX_LEVEL_BLOCKERS, type LabelBlockers } from '../lib/labelBlockers'
import { declutter, LABEL_PAD_PX, type LabelBounds, type LabelCandidates } from '../lib/labelDeclutter'
import { BOX, RECT, uprightAngle, writeBox, writeRect } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import type { LabelCandidate, StreetLabelSource } from '../lib/streetRuns'

/** Gap between an entrance mark's edge and its label, px. */
const MARK_GAP_PX = 6
/** Street labels turn along the street's screen direction over this many meters of it. */
const TANGENT_M = 5
/** Entrance candidates, in preference order: right, left, above, below the mark. */
const ENTRANCE_SIDES = 4
/** Blocked rects before the marks: header, footer, panel (a zero rect when there is none). */
const FIXED_RECTS = 3

/** Typed arrays for one station's labels, sized once: items are its entrances (first), then its streets. */
export interface LabelPlacement {
  entrances: readonly EntranceLabelSource[]
  streets: readonly StreetLabelSource[]
  /** Measured label sizes, px, per item. */
  w: Float32Array
  h: Float32Array
  cand: LabelCandidates
  bounds: LabelBounds
  /** Per box: its screen center, its angle (radians), and for a street its run and candidate index in that run. */
  cx: Float32Array
  cy: Float32Array
  angle: Float32Array
  srcRun: Int16Array
  src: Int16Array
  /** Per item: last placement's run, candidate (-1 for none) and angle (NaN), the preference, the result. */
  lastRun: Int16Array
  lastSrc: Int16Array
  lastAngle: Float32Array
  prefer: Int16Array
  out: Int16Array
  /** Scratch: a run's on-screen candidate indices, and per run its count and whether it was emitted. */
  valid: Int16Array
  runCount: Int16Array
  runDone: Uint8Array
}

export function createLabelPlacement(entrances: readonly EntranceLabelSource[], streets: readonly StreetLabelSource[]): LabelPlacement {
  const n = entrances.length + streets.length
  let boxes = entrances.length * ENTRANCE_SIDES
  let longest = 0
  let runs = 0
  for (const s of streets) {
    for (const r of s.runs) {
      boxes += r.length
      longest = Math.max(longest, r.length)
    }
    runs = Math.max(runs, s.runs.length)
  }
  const minus = (len: number) => new Int16Array(len).fill(-1)
  const rects = FIXED_RECTS + entrances.length + MAX_LEVEL_BLOCKERS
  return {
    entrances,
    streets,
    w: new Float32Array(n),
    h: new Float32Array(n),
    cand: { boxes: new Float32Array(boxes * BOX), start: new Int32Array(n), size: new Int32Array(n), count: n },
    bounds: { viewport: { left: 0, top: 0, right: 0, bottom: 0 }, rects: new Float32Array(rects * RECT), count: 0 },
    cx: new Float32Array(boxes),
    cy: new Float32Array(boxes),
    angle: new Float32Array(boxes),
    srcRun: new Int16Array(boxes),
    src: new Int16Array(boxes),
    lastRun: minus(n),
    lastSrc: minus(n),
    lastAngle: new Float32Array(n).fill(NaN),
    prefer: minus(n),
    out: minus(n),
    valid: new Int16Array(longest),
    runCount: new Int16Array(runs),
    runDone: new Uint8Array(runs),
  }
}

/** This frame's view: the camera, the canvas, and what covers it. */
export interface PlacementView {
  camera: Camera
  /** Canvas size and its offset in the page (r3f's size). */
  width: number
  height: number
  left: number
  top: number
  /** Header and footer bands, px. The HUD measures them against its root, which covers the canvas exactly, so they
   *  are canvas px already; the panel's rect is the viewport's (getBoundingClientRect) and is offset by left/top. */
  insetTop: number
  insetBottom: number
  panel: ScreenRect | null
  /** How far labels keep clear of the panel, px. */
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

function addBox(p: LabelPlacement, box: number, item: number, x: number, y: number, angle: number): void {
  writeBox(p.cand.boxes, box, x, y, p.w[item]!, p.h[item]!, angle)
  p.cx[box] = x
  p.cy[box] = y
  p.angle[box] = angle
}

/** An entrance's mark as a blocked rect and its four candidates around it; returns the next free box. */
function entranceBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number): number {
  const e = p.entrances[i]!
  const rects = p.bounds.rects
  p.cand.start[i] = box
  p.cand.size[i] = 0
  p.prefer[i] = p.lastSrc[i]!
  writeRect(rects, FIXED_RECTS + i, 0, 0, 0, 0)
  const x = anchor.x + e.x
  const z = anchor.z + e.z
  if (!toScreen(a, x, z, view) || !onScreen(a, view)) return box
  // The square's half side on screen: the larger of its two world axes', so a turned view never undersizes it.
  let half = 0
  if (toScreen(b, x + view.markHalfM, z, view)) half = Math.hypot(b.x - a.x, b.y - a.y)
  if (toScreen(b, x, z + view.markHalfM, view)) half = Math.max(half, Math.hypot(b.x - a.x, b.y - a.y))
  writeRect(rects, FIXED_RECTS + i, a.x - half, a.y - half, a.x + half, a.y + half)
  const dx = half + MARK_GAP_PX + p.w[i]! / 2
  const dy = half + MARK_GAP_PX + p.h[i]! / 2
  addBox(p, box, i, a.x + dx, a.y, 0)
  addBox(p, box + 1, i, a.x - dx, a.y, 0)
  addBox(p, box + 2, i, a.x, a.y - dy, 0)
  addBox(p, box + 3, i, a.x, a.y + dy, 0)
  p.cand.size[i] = ENTRANCE_SIDES
  return box + ENTRANCE_SIDES
}

function candidateShows(c: LabelCandidate, anchor: Ground, view: PlacementView, a: Vector3): boolean {
  return c.x * c.x + c.z * c.z <= view.radiusM * view.radiusM && toScreen(a, anchor.x + c.x, anchor.z + c.z, view) && onScreen(a, view)
}

/** One street candidate's box, turned along the street on screen (keeping last frame's reading direction near
 *  vertical); returns the next free box. */
function streetBox(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number, run: number, k: number): number {
  const c = p.streets[i - p.entrances.length]!.runs[run]![k]!
  toScreen(a, anchor.x + c.x, anchor.z + c.z, view)
  const ok = toScreen(b, anchor.x + c.x + c.tx * TANGENT_M, anchor.z + c.z + c.tz * TANGENT_M, view)
  addBox(p, box, i, a.x, a.y, ok ? uprightAngle(b.x - a.x, b.y - a.y, p.lastAngle[i]!) : 0)
  p.srcRun[box] = run
  p.src[box] = k
  if (p.lastRun[i] === run && p.lastSrc[i] === k) p.prefer[i] = box - p.cand.start[i]!
  return box + 1
}

/** A run's on-screen candidates within the radius, from the visible stretch's middle outward; returns the next box. */
function runBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number, run: number): number {
  const cands = p.streets[i - p.entrances.length]!.runs[run]!
  let n = 0
  for (let k = 0; k < cands.length; k++) if (candidateShows(cands[k]!, anchor, view, a)) p.valid[n++] = k
  const mid = (n - 1) >> 1
  for (let d = 0; d <= n; d++) {
    if (mid + d < n) box = streetBox(p, i, anchor, view, a, b, box, run, p.valid[mid + d]!)
    if (d > 0 && mid - d >= 0) box = streetBox(p, i, anchor, view, a, b, box, run, p.valid[mid - d]!)
  }
  return box
}

/**
 * A street's candidates: first its run with the most on-screen candidates within the radius (last placement's run
 * while it has at most one fewer, so the label doesn't hop between carriageways), then its other runs by count, so
 * the label falls back to another run when the first has no room. Returns the next free box.
 */
function streetBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number): number {
  const runs = p.streets[i - p.entrances.length]!.runs
  p.cand.start[i] = box
  p.prefer[i] = -1
  let best = -1
  for (let r = 0; r < runs.length; r++) {
    let count = 0
    for (let k = 0; k < runs[r]!.length; k++) if (candidateShows(runs[r]![k]!, anchor, view, a)) count++
    p.runCount[r] = count
    p.runDone[r] = 0
    if (count > 0 && (best < 0 || count > p.runCount[best]!)) best = r
  }
  const last = p.lastRun[i]!
  if (best >= 0 && last >= 0 && last < runs.length && p.runCount[last]! >= Math.max(p.runCount[best]! - 1, 1)) best = last
  while (best >= 0) {
    box = runBoxes(p, i, anchor, view, a, b, box, best)
    p.runDone[best] = 1
    best = -1
    for (let r = 0; r < runs.length; r++) {
      if (!p.runDone[r] && p.runCount[r]! > 0 && (best < 0 || p.runCount[r]! > p.runCount[best]!)) best = r
    }
  }
  p.cand.size[i] = box - p.cand.start[i]!
  return box
}

/**
 * Builds every candidate for this view, declutters (keeping clear of the header, footer, panel, entrance marks and
 * the level labels in `levels`), and records the picks for next time. Allocation-free.
 */
export function placeLabels(p: LabelPlacement, anchor: Ground, view: PlacementView, levels: LabelBlockers, a: Vector3, b: Vector3): void {
  const { bounds } = p
  const rects = bounds.rects
  const v = bounds.viewport
  v.right = view.width
  v.bottom = view.height
  writeRect(rects, 0, 0, 0, view.width, view.insetTop)
  writeRect(rects, 1, 0, view.height - view.insetBottom, view.width, view.height)
  const q = view.panel
  const pad = view.panelPad
  if (q) writeRect(rects, 2, q.left - view.left - pad, q.top - view.top - pad, q.right - view.left + pad, q.bottom - view.top + pad)
  else writeRect(rects, 2, 0, 0, 0, 0)
  const e = p.entrances.length
  let box = 0
  for (let i = 0; i < e; i++) box = entranceBoxes(p, i, anchor, view, a, b, box)
  for (let i = e; i < p.cand.count; i++) box = streetBoxes(p, i, anchor, view, a, b, box)
  const first = FIXED_RECTS + e
  const shown = Math.min(levels.count, MAX_LEVEL_BLOCKERS)
  for (let r = 0; r < shown; r++) {
    const o = r * RECT
    const lr = levels.rects
    writeRect(rects, first + r, lr[o]! - LABEL_PAD_PX, lr[o + 1]! - LABEL_PAD_PX, lr[o + 2]! + LABEL_PAD_PX, lr[o + 3]! + LABEL_PAD_PX)
  }
  bounds.count = first + shown
  declutter(p.cand, bounds, p.prefer, p.out)
  for (let i = 0; i < p.cand.count; i++) {
    const k = p.out[i]!
    const chosen = p.cand.start[i]! + k
    p.lastRun[i] = k < 0 || i < e ? -1 : p.srcRun[chosen]!
    p.lastSrc[i] = k < 0 ? -1 : i < e ? k : p.src[chosen]!
    p.lastAngle[i] = k < 0 ? NaN : p.angle[chosen]!
  }
}
