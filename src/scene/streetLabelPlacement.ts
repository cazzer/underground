import type { Vector3 } from 'three'
import type { LabelBlockers } from '../lib/labelBlockers'
import { declutter, setExempt } from '../lib/labelDeclutter'
import { entranceBoxes, rankEntrances } from './entranceLabelBoxes'
import { entranceOf, FIXED_RECTS, type LabelPlacement, type PlacementView } from './labelPlacementState'
import { stationPoint, writeBlockedRects, writeInteriorRects } from './labelRects'
import { markNamedStreets, markPlacedKeys, rankStreets, streetBoxes } from './streetLabelBoxes'

/**
 * The trip exit's label (`view.priorityEntrance`, the focused station's, the first segment) may cover every drawn
 * station's entrance marks: among a crowded corner's marks it would otherwise find no box, and naming the way out
 * matters more than keeping a neighbour's mark clear.
 */
export function exemptExitFromMarks(p: LabelPlacement, view: PlacementView): void {
  if (view.priorityEntrance < 0 || !view.focusedFirst || p.stations.length === 0) return
  for (let i = p.segItem0[0]!; i < p.segStreet0[0]!; i++) {
    if (!entranceOf(p, i).members.includes(view.priorityEntrance)) continue
    for (let k = FIXED_RECTS; k < p.markerRect; k++) setExempt(p.bounds, k, i)
    return
  }
}

/**
 * Builds every candidate for this view and declutters station by station (in `p.stations`' order: the focused one
 * first, then by when each joined), each station's entrances then its streets, recording the picks for next time.
 * Allocation-free. All labels keep clear of the header, footer, panel, every station's entrance marks, nearby
 * station markers (and the focus ring) and the level labels in `levels`; street names also of every drawn
 * interior's outlines. Entrances rank by `rankEntrances`, streets those the station's placed entrance labels name
 * first. Every station but the focused one places at most `view.budgetEntrances` and `view.budgetStreets` labels,
 * and a street an earlier station labelled gets no second label.
 */
export function placeLabels(p: LabelPlacement, view: PlacementView, levels: LabelBlockers, a: Vector3, b: Vector3): void {
  const blocked = writeBlockedRects(p, view, levels, a, b)
  const withOutlines = writeInteriorRects(p, view, blocked, a, b)
  const markerCount = p.nearby.length + 1
  p.keyPlaced.fill(0)
  let box = 0
  for (let s = 0; s < p.stations.length; s++) {
    const focused = s === 0 && view.focusedFirst
    stationPoint(view, p.stations[s]!.layer.anchor, a)
    p.bounds.count = blocked
    const e0 = p.segItem0[s]!
    const s0 = p.segStreet0[s]!
    const end = p.segEnd[s]!
    for (let i = e0; i < s0; i++) box = entranceBoxes(p, i, view, a, b, box, p.markerRect, markerCount)
    if (focused) exemptExitFromMarks(p, view)
    rankEntrances(p, view, s)
    declutter(p.cand, p.bounds, p.prefer, p.out, e0, s0, focused ? Infinity : view.budgetEntrances)
    markNamedStreets(p, s)
    for (let i = s0; i < end; i++) box = streetBoxes(p, i, view, a, b, box)
    rankStreets(p, s)
    p.bounds.count = withOutlines
    declutter(p.cand, p.bounds, p.prefer, p.out, s0, end, focused ? Infinity : view.budgetStreets)
    markPlacedKeys(p, s)
  }
  for (let i = 0; i < p.cand.count; i++) {
    const k = p.out[i]!
    const chosen = p.cand.start[i]! + k
    const street = p.keyId[i]! >= 0 && k >= 0
    p.lastRun[i] = street ? p.srcRun[chosen]! : -1
    p.lastSrc[i] = k < 0 ? -1 : street ? p.src[chosen]! : k
    p.lastSide[i] = street ? p.srcSide[chosen]! : 0
    p.lastAngle[i] = k < 0 ? NaN : p.angle[chosen]!
    p.lastFirst[i] = k === 0 ? 1 : 0
  }
}
