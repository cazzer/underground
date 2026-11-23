import type { Vector3 } from 'three'
import { MAX_OUTLINE_SAMPLES } from '../lib/interiorOutline'
import { BLOCKER_SLOTS, MAX_LEVEL_BLOCKERS, type LabelBlockers } from '../lib/labelBlockers'
import { declutter, LABEL_PAD_PX } from '../lib/labelDeclutter'
import { RECT, writeRect } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import { entranceBoxes, rankEntrances } from './entranceLabelBoxes'
import { FIXED_RECTS, groundHalfPx, neighbourCount, toScreen, type LabelPlacement, type PlacementView } from './labelPlacementState'
import { markNamedStreets, rankStreets, streetBoxes } from './streetLabelBoxes'

/** Gap the camera framing keeps between the free area and the panel (interiorFreeRect), px. */
const FREE_GAP_PX = 16
/** How far street names keep clear of each interior outline point on screen, px (the points are a few px apart). */
const INTERIOR_PAD_PX = 6

/** Writes rect `r` as the screen square of half side `halfM` around ground point (x, z), or a zero rect off screen. */
function markRect(rects: Float32Array, r: number, x: number, z: number, halfM: number, view: PlacementView, a: Vector3, b: Vector3): void {
  if (!toScreen(a, x, 0, z, view)) {
    writeRect(rects, r, 0, 0, 0, 0)
    return
  }
  const half = groundHalfPx(a, b, x, z, halfM, view)
  writeRect(rects, r, a.x - half, a.y - half, a.x + half, a.y + half)
}

/** Writes a padded rect at each of the interior's outline points on screen from rect `r` on (a zero rect for one
 *  behind the camera); returns the next free rect. The pad is at least half the points' spacing on screen, so the
 *  rects join up along each outline. */
function interiorRects(rects: Float32Array, r: number, view: PlacementView, a: Vector3, b: Vector3): number {
  const m = view.interior
  if (!m) return r
  const o = m.outline.points
  const n = Math.min(o.length / 3, MAX_OUTLINE_SAMPLES)
  let pad = INTERIOR_PAD_PX
  if (toScreen(a, m.origin.x, 0, m.origin.z, view)) pad = Math.max(pad, groundHalfPx(a, b, m.origin.x, m.origin.z, m.outline.stepM / 2, view) + 2)
  for (let k = 0; k < n; k++) {
    if (toScreen(a, m.origin.x + o[3 * k]!, o[3 * k + 1]! * view.depthScale, m.origin.z + o[3 * k + 2]!, view)) {
      writeRect(rects, r++, a.x - pad, a.y - pad, a.x + pad, a.y + pad)
    } else writeRect(rects, r++, 0, 0, 0, 0)
  }
  return r
}

/** The fixed rects (header, footer, panel), and the free area's middle and the station's point into `view`. */
function frame(p: LabelPlacement, anchor: Ground, view: PlacementView, a: Vector3): void {
  const { rects, viewport } = p.bounds
  viewport.right = view.width
  viewport.bottom = view.height
  writeRect(rects, 0, 0, 0, view.width, view.insetTop)
  writeRect(rects, 1, 0, view.height - view.insetBottom, view.width, view.height)
  let right = view.width
  let bottom = view.height - view.insetBottom
  const q = view.panel
  if (q) {
    const pad = view.panelPad
    const left = q.left - view.left
    const top = q.top - view.top
    writeRect(rects, 2, left - pad, top - pad, q.right - view.left + pad, q.bottom - view.top + pad)
    if (left > view.width / 2) right = Math.max(left - FREE_GAP_PX, 1)
    else bottom = Math.max(Math.min(bottom, top - FREE_GAP_PX), view.insetTop + 1)
  } else writeRect(rects, 2, 0, 0, 0, 0)
  view.focusX = right / 2
  view.focusY = (view.insetTop + bottom) / 2
  const seen = toScreen(a, anchor.x, 0, anchor.z, view)
  view.stationX = seen ? a.x : view.focusX
  view.stationY = seen ? a.y : view.focusY
}

/**
 * The trip exit's label (`view.priorityEntrance`) may cover other entrances' marks: among a crowded corner's marks it
 * would otherwise find no box, and naming the way out matters more than keeping a neighbour's mark clear.
 */
export function exemptExitFromMarks(p: LabelPlacement, view: PlacementView): void {
  if (view.priorityEntrance < 0) return
  for (let i = 0; i < p.entrances.length && i < 32; i++) {
    if (!p.entrances[i]!.members.includes(view.priorityEntrance)) continue
    const exempt = p.bounds.exempt!
    const end = FIXED_RECTS + p.marks.length + neighbourCount(p, view)
    for (let k = FIXED_RECTS; k < end; k++) exempt[k] = exempt[k]! | (1 << i)
    return
  }
}

/**
 * Builds every candidate for this view and declutters in two passes, recording the picks for next time.
 * Allocation-free. All labels keep clear of the header, footer, panel, every entrance mark, nearby station markers
 * (and the focus ring) and the level labels in `levels`. Entrances go first, ranked by `rankEntrances`; then streets,
 * those the placed entrance labels name first, also clear of the interior's outlines.
 */
export function placeLabels(p: LabelPlacement, anchor: Ground, view: PlacementView, levels: LabelBlockers, a: Vector3, b: Vector3): void {
  frame(p, anchor, view, a)
  const rects = p.bounds.rects
  let r = FIXED_RECTS
  for (let k = 0; k < p.marks.length; k++) markRect(rects, r++, anchor.x + p.marks[k]!.x, anchor.z + p.marks[k]!.z, view.markHalfM, view, a, b)
  // The other drawn layers' entrance marks, the same size.
  const nm = view.neighbourMarks
  for (let k = 0, n = neighbourCount(p, view); k < n; k++) markRect(rects, r++, nm![2 * k]!, nm![2 * k + 1]!, view.markHalfM, view, a, b)
  // Station markers and the focus ring, sized as drawn now; an entrance whose own mark sits in one ignores it.
  const markerRect = r
  for (let k = 0; k < p.stations.length; k++) {
    if (view.markerHidden?.[k] === 1) writeRect(rects, r++, 0, 0, 0, 0)
    else markRect(rects, r++, p.stations[k]!.x, p.stations[k]!.z, view.markerRadiusM, view, a, b)
  }
  const ring = view.focusRing
  if (ring) markRect(rects, r, ring.x, ring.z, view.ringRadiusM, view, a, b)
  else writeRect(rects, r, 0, 0, 0, 0)
  r++
  const markerCount = r - markerRect
  p.bounds.exempt!.fill(0)
  const lr = levels.rects
  // Every drawn interior's slot: the level labels of each.
  for (let s = 0; s < BLOCKER_SLOTS; s++) {
    const shown = Math.min(levels.counts[s]!, MAX_LEVEL_BLOCKERS)
    for (let k = 0; k < shown; k++) {
      const o = (s * MAX_LEVEL_BLOCKERS + k) * RECT
      writeRect(rects, r++, lr[o]! - LABEL_PAD_PX, lr[o + 1]! - LABEL_PAD_PX, lr[o + 2]! + LABEL_PAD_PX, lr[o + 3]! + LABEL_PAD_PX)
    }
  }
  p.bounds.count = r
  const e = p.entrances.length
  let box = 0
  for (let i = 0; i < e; i++) box = entranceBoxes(p, i, anchor, view, a, b, box, markerRect, markerCount)
  exemptExitFromMarks(p, view)
  rankEntrances(p, view)
  declutter(p.cand, p.bounds, p.prefer, p.out, 0, e)
  markNamedStreets(p)
  for (let i = e; i < p.cand.count; i++) box = streetBoxes(p, i, anchor, view, a, b, box)
  rankStreets(p)
  p.bounds.count = interiorRects(rects, r, view, a, b)
  declutter(p.cand, p.bounds, p.prefer, p.out, e, p.cand.count)
  for (let i = 0; i < p.cand.count; i++) {
    const k = p.out[i]!
    const chosen = p.cand.start[i]! + k
    const street = i >= e && k >= 0
    p.lastRun[i] = street ? p.srcRun[chosen]! : -1
    p.lastSrc[i] = k < 0 ? -1 : street ? p.src[chosen]! : k
    p.lastSide[i] = street ? p.srcSide[chosen]! : 0
    p.lastAngle[i] = k < 0 ? NaN : p.angle[chosen]!
    p.lastFirst[i] = k === 0 ? 1 : 0
  }
}
