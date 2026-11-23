/** The blocked rects of the shared label pass (o3r.6), written per placement, each run closed as a rect group
 *  (labelRectGroups.ts) so a candidate far from it skips it. Allocation-free. */
import type { Vector3 } from 'three'
import { MAX_OUTLINE_SAMPLES } from '../lib/interiorOutline'
import { BLOCKER_SLOTS, MAX_LEVEL_BLOCKERS, type LabelBlockers } from '../lib/labelBlockers'
import { LABEL_PAD_PX } from '../lib/labelDeclutter'
import { RECT, writeRect } from '../lib/labelGeometry'
import { closeGroup } from '../lib/labelRectGroups'
import type { Ground } from '../lib/projection'
import type { InteriorModel } from './interiorModel'
import { FIXED_RECTS, groundHalfPx, MAX_LABEL_INTERIORS, toScreen, type LabelPlacement, type PlacementView } from './labelPlacementState'

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
function interiorRects(m: InteriorModel, rects: Float32Array, r: number, view: PlacementView, a: Vector3, b: Vector3): number {
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

/** The fixed rects (header, footer, panel), and the free area's middle into `view`. */
function frame(p: LabelPlacement, view: PlacementView): void {
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
}

/** The station at `anchor`'s point on screen into `view` (the free area's middle when it isn't in front). */
export function stationPoint(view: PlacementView, anchor: Ground, a: Vector3): void {
  const seen = toScreen(a, anchor.x, 0, anchor.z, view)
  view.stationX = seen ? a.x : view.focusX
  view.stationY = seen ? a.y : view.focusY
}

/**
 * Every rect but the interiors' outlines: the fixed ones, each station's entrance marks, the nearby station markers
 * (sized as drawn now; a hidden one a zero rect) and the focus ring, every level label slot's rects; one group each.
 * Clears the exemptions. Returns the rect count.
 */
export function writeBlockedRects(p: LabelPlacement, view: PlacementView, levels: LabelBlockers, a: Vector3, b: Vector3): number {
  frame(p, view)
  const { rects, groups } = p.bounds
  closeGroup(groups!, 0, rects, 0, FIXED_RECTS)
  let g = 1
  for (let s = 0; s < p.stations.length; s++) {
    const { anchor, marks } = p.stations[s]!.layer
    const first = p.segMark0[s]!
    for (let k = 0; k < marks.length; k++) markRect(rects, first + k, anchor.x + marks[k]!.x, anchor.z + marks[k]!.z, view.markHalfM, view, a, b)
    closeGroup(groups!, g++, rects, first, p.segMarkEnd[s]!)
  }
  let r = p.markerRect
  for (let k = 0; k < p.nearby.length; k++) {
    if (view.markerHidden?.[k] === 1) writeRect(rects, r++, 0, 0, 0, 0)
    else markRect(rects, r++, p.nearby[k]!.x, p.nearby[k]!.z, view.markerRadiusM, view, a, b)
  }
  const ring = view.focusRing
  if (ring) markRect(rects, r, ring.x, ring.z, view.ringRadiusM, view, a, b)
  else writeRect(rects, r, 0, 0, 0, 0)
  r++
  closeGroup(groups!, g++, rects, p.markerRect, r)
  const lr = levels.rects
  for (let s = 0; s < BLOCKER_SLOTS; s++) {
    const first = r
    const shown = Math.min(levels.counts[s]!, MAX_LEVEL_BLOCKERS)
    for (let k = 0; k < shown; k++) {
      const o = (s * MAX_LEVEL_BLOCKERS + k) * RECT
      writeRect(rects, r++, lr[o]! - LABEL_PAD_PX, lr[o + 1]! - LABEL_PAD_PX, lr[o + 2]! + LABEL_PAD_PX, lr[o + 3]! + LABEL_PAD_PX)
    }
    closeGroup(groups!, g++, rects, first, r)
  }
  p.bounds.groupCount = g
  p.bounds.exempt!.fill(0)
  return r
}

/** Every drawn interior's outline from rect `r` on (the first MAX_LABEL_INTERIORS), one group each, after those
 *  writeBlockedRects closed; returns the rect count. */
export function writeInteriorRects(p: LabelPlacement, view: PlacementView, r: number, a: Vector3, b: Vector3): number {
  const { rects, groups } = p.bounds
  let g = p.bounds.groupCount!
  for (let k = 0; k < view.interiors.length && k < MAX_LABEL_INTERIORS; k++) {
    const first = r
    r = interiorRects(view.interiors[k]!, rects, r, view, a, b)
    closeGroup(groups!, g++, rects, first, r)
  }
  p.bounds.groupCount = g
  return r
}
