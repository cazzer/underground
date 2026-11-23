import type { Camera, Vector3 } from 'three'
import type { EntranceLabelSource, StreetLayer } from '../data/useStationStreets'
import type { ScreenRect } from '../lib/interiorCamera'
import type { LabelBounds, LabelCandidates } from '../lib/labelDeclutter'
import { writeBox } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import type { StreetLabelSource } from '../lib/streetRuns'
import { MAX_VIEW_INTERIORS } from '../lib/viewStations'
import type { InteriorModel } from './interiorModel'

/** Entrance candidates: right and left of the mark, then a corner of the label at each of its corners. */
export const ENTRANCE_SLOTS = 6
/** Street candidates: offset to the side away from the station, to the other side, then on the centerline. */
export const STREET_SLOTS = 3
/** Blocked rects before the marks: header, footer, panel (a zero rect when there is none). */
export const FIXED_RECTS = 3
/** Drawn interiors whose outlines the street names keep clear of: the view's, and as many again leaving. */
export const MAX_LABEL_INTERIORS = 2 * MAX_VIEW_INTERIORS

/** One drawn station in the label pass: its street layer and, per street and run, each candidate's subway bundle
 *  along the street (routeBundles.ts, BUNDLE_STRIDE floats). */
export interface PlacementStation {
  layer: StreetLayer
  bundles: readonly (readonly Float32Array[])[]
}

/**
 * Typed arrays for every drawn station's labels, sized once per station set (labelPlacementLayout.ts). Items are flat
 * across the stations, station by station (segment s): its entrances, then its streets. Order positions match item
 * indexes, so a segment's entrances rank within [segItem0, segStreet0) and its streets within [segStreet0, segEnd).
 * Blocked rects: the fixed ones, each station's entrance marks, the nearby station markers and the focus ring, the
 * level labels, then each drawn interior's outline; one rect group (labelDeclutter.ts GROUP) each.
 */
export interface LabelPlacement {
  stations: readonly PlacementStation[]
  /** Station markers the labels keep clear of (scene ground); a rect for the focus ring follows theirs. */
  nearby: readonly Ground[]
  /** Per station: its first entrance item, its first street item, one past its last item, and its mark rects. */
  segItem0: Int32Array
  segStreet0: Int32Array
  segEnd: Int32Array
  segMark0: Int32Array
  segMarkEnd: Int32Array
  /** The first marker rect (the nearby markers, then the focus ring) and the first level label rect. */
  markerRect: number
  levelRect: number
  /** Per item: its station, its index in that station's entrances or streets, and its street key's id (-1 for an
   *  entrance); per key id, whether a street label with it is placed this pass (one label per street in view). */
  stationOf: Uint8Array
  local: Int16Array
  keyId: Int16Array
  keyPlaced: Uint8Array
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
  /** Scratch, per item: an entrance mark's screen point and rank score, a head house's best score (at its station's
   *  first item plus the house index), whether a placed entrance label names a street; per run its on-screen count
   *  and whether it was emitted. */
  markX: Float32Array
  markY: Float32Array
  score: Float64Array
  houseBest: Float64Array
  named: Uint8Array
  runCount: Int16Array
  runDone: Uint8Array
}

/** Entrance item `i`'s source. */
export function entranceOf(p: LabelPlacement, i: number): EntranceLabelSource {
  return p.stations[p.stationOf[i]!]!.layer.entrances[p.local[i]!]!
}

/** Street item `i`'s source. */
export function streetOf(p: LabelPlacement, i: number): StreetLabelSource {
  return p.stations[p.stationOf[i]!]!.layer.streets[p.local[i]!]!
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
  /** How far from its anchor a street label may sit, meters. */
  radiusM: number
  /** An entrance mark's half side, and a station marker's and the focus ring's radius as drawn now, meters. */
  markHalfM: number
  markerRadiusM: number
  ringRadiusM: number
  /** The focused station's point while it draws a focus ring (no interior), else null. */
  focusRing: Ground | null
  /** Per nearby station (parallel to `LabelPlacement.nearby`): 1 while its marker isn't drawn (a view interior stands
   *  in for it, faded out), so it blocks nothing; null for all drawn. */
  markerHidden: Uint8Array | null
  /** Every drawn interior, whose outlines the street names keep clear of (the first MAX_LABEL_INTERIORS), and their
   *  groups' y scale. */
  interiors: readonly InteriorModel[]
  depthScale: number
  /** The first station is the focused one: it places unbudgeted, and only it ranks and tints the trip's exit. */
  focusedFirst: boolean
  /** How many entrance and street labels each other station may place. */
  budgetEntrances: number
  budgetStreets: number
  /** The focused station's street-file entrance index of the trip's exit; the label that has it among its `members`
   *  ranks before every other entrance while its path is drawn; -1 for none. */
  priorityEntrance: number
  /** Ignore last placement's picks this time (the view has settled): every label takes its best spot again. */
  fresh: boolean
  /** Scratch, written by placeLabels: the free area's middle, and the point of the station being placed, canvas px. */
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
    markerHidden: null,
    interiors: [],
    depthScale: 1,
    focusedFirst: false,
    budgetEntrances: Infinity,
    budgetStreets: Infinity,
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
