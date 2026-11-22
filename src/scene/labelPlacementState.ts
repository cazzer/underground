import type { Camera, Vector3 } from 'three'
import type { EntranceLabelSource } from '../data/useStationStreets'
import type { ScreenRect } from '../lib/interiorCamera'
import { MAX_OUTLINE_SAMPLES } from '../lib/interiorOutline'
import { MAX_LEVEL_BLOCKERS } from '../lib/labelBlockers'
import type { LabelBounds, LabelCandidates } from '../lib/labelDeclutter'
import { BOX, RECT, writeBox } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import type { StreetLabelSource } from '../lib/streetRuns'
import type { InteriorModel } from './interiorModel'

/** Entrance candidates: right and left of the mark, then a corner of the label at each of its corners. */
export const ENTRANCE_SLOTS = 6
/** Street candidates: offset to the side away from the station, to the other side, then on the centerline. */
export const STREET_SLOTS = 3
/** Blocked rects before the marks: header, footer, panel (a zero rect when there is none). */
export const FIXED_RECTS = 3

/** Typed arrays for one station's labels, sized once: items are its entrances (first), then its streets. */
export interface LabelPlacement {
  entrances: readonly EntranceLabelSource[]
  streets: readonly StreetLabelSource[]
  /** Every entrance mark (meters from the anchor) and nearby station marker but the focused one's (scene ground),
   *  blocked for all labels. */
  marks: readonly Ground[]
  stations: readonly Ground[]
  /** Per street and run: each candidate's subway bundle along the street (routeBundles.ts, BUNDLE_STRIDE floats). */
  bundles: readonly (readonly Float32Array[])[]
  /** Measured label sizes, px, and line count, per item. */
  w: Float32Array
  h: Float32Array
  lines: Uint8Array
  cand: LabelCandidates
  bounds: LabelBounds
  /** Per box: its screen center and angle (radians); for a street its run, candidate index in that run and side. */
  cx: Float32Array
  cy: Float32Array
  angle: Float32Array
  srcRun: Int16Array
  src: Int16Array
  srcSide: Int8Array
  /** Per item: last placement's run, candidate (-1 for none), side, angle (NaN) and whether it was its first
   *  candidate; the preference, the result. */
  lastFirst: Uint8Array
  lastRun: Int16Array
  lastSrc: Int16Array
  lastSide: Int8Array
  lastAngle: Float32Array
  prefer: Int16Array
  out: Int16Array
  /** Scratch: each entrance mark's screen point and rank score, each head house's best score; per run its on-screen
   *  count and whether it was emitted; per street whether a placed entrance label names it. */
  markX: Float32Array
  markY: Float32Array
  score: Float64Array
  houseBest: Float64Array
  runCount: Int16Array
  runDone: Uint8Array
  named: Uint8Array
}

export function createLabelPlacement(
  entrances: readonly EntranceLabelSource[],
  streets: readonly StreetLabelSource[],
  marks: readonly Ground[],
  stations: readonly Ground[],
  bundles: readonly (readonly Float32Array[])[],
): LabelPlacement {
  const n = entrances.length + streets.length
  let boxes = entrances.length * ENTRANCE_SLOTS
  let runs = 0
  for (const s of streets) {
    for (const r of s.runs) {
      boxes += r.length * STREET_SLOTS
    }
    runs = Math.max(runs, s.runs.length)
  }
  const minus = (len: number) => new Int16Array(len).fill(-1)
  // The marks, the nearby stations and the focus ring, the level labels, then the interior (street names only).
  const rects = FIXED_RECTS + marks.length + stations.length + 1 + MAX_LEVEL_BLOCKERS + MAX_OUTLINE_SAMPLES
  return {
    entrances,
    streets,
    marks,
    stations,
    bundles,
    w: new Float32Array(n),
    h: new Float32Array(n),
    lines: new Uint8Array(n).fill(1),
    cand: {
      boxes: new Float32Array(boxes * BOX),
      start: new Int32Array(n),
      size: new Int32Array(n),
      order: new Int16Array(n).map((_, i) => i),
      count: n,
    },
    bounds: {
      viewport: { left: 0, top: 0, right: 0, bottom: 0 },
      rects: new Float32Array(rects * RECT),
      count: 0,
      exempt: new Uint32Array(rects),
    },
    cx: new Float32Array(boxes),
    cy: new Float32Array(boxes),
    angle: new Float32Array(boxes),
    srcRun: new Int16Array(boxes),
    src: new Int16Array(boxes),
    srcSide: new Int8Array(boxes),
    lastFirst: new Uint8Array(n),
    lastRun: minus(n),
    lastSrc: minus(n),
    lastSide: new Int8Array(n),
    lastAngle: new Float32Array(n).fill(NaN),
    prefer: minus(n),
    out: minus(n),
    markX: new Float32Array(entrances.length),
    markY: new Float32Array(entrances.length),
    score: new Float64Array(entrances.length),
    houseBest: new Float64Array(entrances.length),
    runCount: new Int16Array(runs),
    runDone: new Uint8Array(runs),
    named: new Uint8Array(streets.length),
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
  /** An entrance mark's half side, and a station marker's and the focus ring's radius as drawn now, meters. */
  markHalfM: number
  markerRadiusM: number
  ringRadiusM: number
  /** The focused station's point while it draws a focus ring (no interior), else null. */
  focusRing: Ground | null
  /** The loaded interior, whose outlines the street names keep clear of, and its group's y scale. */
  interior: InteriorModel | null
  depthScale: number
  /** The street-file entrance index (`EntranceText.index`) of the trip's exit label, ranked before every other
   *  entrance while its path is drawn; -1 for none. */
  priorityEntrance: number
  /** Ignore last placement's picks this time (the view has settled): every label takes its best spot again. */
  fresh: boolean
  /** Scratch, written by placeLabels: the free area's middle and the station's point, canvas px. */
  focusX: number
  focusY: number
  stationX: number
  stationY: number
}

/** Labels keep this far clear of the station panel, px. */
const PANEL_PAD_PX = 8

/** A blank view; useStreetLabels writes it field by field before each placement. */
export function newView(camera: PlacementView['camera'], markHalfM: number): PlacementView {
  return {
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
    markerRadiusM: 0,
    ringRadiusM: 0,
    focusRing: null,
    interior: null,
    depthScale: 1,
    priorityEntrance: -1,
    fresh: false,
    focusX: 0,
    focusY: 0,
    stationX: 0,
    stationY: 0,
  }
}

/** Projects world (x, y, z) into canvas px in `v`; false when behind the camera or past its far plane. */
export function toScreen(v: Vector3, x: number, y: number, z: number, view: PlacementView): boolean {
  v.set(x, y, z).project(view.camera)
  if (!(Math.abs(v.z) < 1)) return false
  v.x = ((v.x + 1) * view.width) / 2
  v.y = ((1 - v.y) * view.height) / 2
  return true
}

export function onScreen(v: Vector3, view: PlacementView): boolean {
  return v.x >= 0 && v.x <= view.width && v.y >= 0 && v.y <= view.height
}

/** The screen half side of a `halfM` square on the ground at the point `a` already projected from (x, z): the larger
 *  of its two world axes', so a turned view never undersizes it. */
export function groundHalfPx(a: Vector3, b: Vector3, x: number, z: number, halfM: number, view: PlacementView): number {
  let half = 0
  if (toScreen(b, x + halfM, 0, z, view)) half = Math.hypot(b.x - a.x, b.y - a.y)
  if (toScreen(b, x, 0, z + halfM, view)) half = Math.max(half, Math.hypot(b.x - a.x, b.y - a.y))
  return half
}

export function addBox(p: LabelPlacement, box: number, item: number, x: number, y: number, angle: number): void {
  writeBox(p.cand.boxes, box, x, y, p.w[item]!, p.h[item]!, angle)
  p.cx[box] = x
  p.cy[box] = y
  p.angle[box] = angle
}
