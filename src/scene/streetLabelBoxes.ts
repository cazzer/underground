import type { Vector3 } from 'three'
import { uprightAngle } from '../lib/labelGeometry'
import type { Ground } from '../lib/projection'
import { DESKTOP_LABEL_RADIUS_M } from '../lib/streetLabelReveal'
import type { LabelCandidate } from '../lib/streetRuns'
import { BUNDLE_STRIDE } from '../lib/routeBundles'
import { theme } from '../theme'
import { addBox, entranceOf, onScreen, STREET_SLOTS, streetOf, toScreen, type LabelPlacement, type PlacementView } from './labelPlacementState'

/** Street labels turn along the street's screen direction over this many meters of it. */
const TANGENT_M = 5
/** An offset label's edge sits this far off the street's centerline (or the subway bundle along it), px. */
const OFFSET_GAP_PX = 3
/** Where a slot that must not be used is parked: far off screen, so it never fits. */
const NOWHERE = -1e6

function radiusOf(p: LabelPlacement, i: number, view: PlacementView): number {
  // A street an entrance label names is worth reaching for: out to the desktop radius on a phone too.
  return p.named[i] ? Math.max(view.radiusM, DESKTOP_LABEL_RADIUS_M) : view.radiusM
}

function shows(c: LabelCandidate, anchor: Ground, view: PlacementView, radius: number, a: Vector3): boolean {
  return c.x * c.x + c.z * c.z <= radius * radius && toScreen(a, anchor.x + c.x, 0, anchor.z + c.z, view) && onScreen(a, view)
}

/** Records box `box` as candidate (run, k, side) and makes it the preference if it was last placement's pick. */
function note(p: LabelPlacement, i: number, view: PlacementView, box: number, run: number, k: number, side: number): void {
  p.srcRun[box] = run
  p.src[box] = k
  p.srcSide[box] = side
  const keep = !view.fresh || p.lastFirst[i]
  if (keep && p.lastRun[i] === run && p.lastSrc[i] === k && p.lastSide[i] === side) p.prefer[i] = box - p.cand.start[i]!
}

/**
 * One street candidate's three boxes, turned along the street on screen (keeping last placement's reading direction
 * near vertical): offset off the centerline on the side away from the station, on the other side, then centered.
 * Where subway routes run along the street the offsets clear their bundle (its tracks' lateral extent that side, plus
 * half a band pitch per route) and the centered slot is unused. Returns the next free box.
 */
function candidateBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number, run: number, k: number): number {
  const c = streetOf(p, i).runs[run]![k]!
  toScreen(a, anchor.x + c.x, 0, anchor.z + c.z, view)
  const ax = a.x
  const ay = a.y
  const ok = toScreen(b, anchor.x + c.x + c.tx * TANGENT_M, 0, anchor.z + c.z + c.tz * TANGENT_M, view)
  const angle = ok ? uprightAngle(b.x - ax, b.y - ay, p.lastAngle[i]!) : 0
  const pxPerM = ok ? Math.hypot(b.x - ax, b.y - ay) / TANGENT_M : 0
  // The label's own "down" on screen, and the side of the street away from the station.
  const nx = -Math.sin(angle)
  const ny = Math.cos(angle)
  const away = nx * (ax - view.stationX) + ny * (ay - view.stationY) >= 0 ? 1 : -1
  const bundle = p.stations[p.stationOf[i]!]!.bundles[p.local[i]!]![run]!
  const routes = bundle[k * BUNDLE_STRIDE]!
  // How far the bundle reaches off the centerline on the label's +n side and its -n side, px: the street's left in
  // the world ((-tz, tx)) is +n on screen when it projects that way.
  let plus = 0
  let minus = 0
  if (routes > 0 && toScreen(b, anchor.x + c.x - c.tz, 0, anchor.z + c.z + c.tx, view)) {
    const left = (b.x - ax) * nx + (b.y - ay) * ny >= 0
    const lo = -bundle[k * BUNDLE_STRIDE + 1]! * pxPerM
    const hi = bundle[k * BUNDLE_STRIDE + 2]! * pxPerM
    const edge = (routes * theme.bandPitchPx) / 2 + theme.lineWidth
    plus = (left ? hi : lo) + edge
    minus = (left ? lo : hi) + edge
  }
  const d = p.h[i]! / 2 + OFFSET_GAP_PX
  const dAway = d + (away > 0 ? plus : minus)
  const dOther = d + (away > 0 ? minus : plus)
  addBox(p, box, i, ax + away * dAway * nx, ay + away * dAway * ny, angle)
  note(p, i, view, box, run, k, away)
  addBox(p, box + 1, i, ax - away * dOther * nx, ay - away * dOther * ny, angle)
  note(p, i, view, box + 1, run, k, -away)
  addBox(p, box + 2, i, routes > 0 ? NOWHERE : ax, routes > 0 ? NOWHERE : ay, angle)
  note(p, i, view, box + 2, run, k, 0)
  return box + STREET_SLOTS
}

/** A run's on-screen candidates within the radius, nearest the station first (their stored order); returns the next
 *  free box. */
function runBoxes(p: LabelPlacement, i: number, anchor: Ground, view: PlacementView, a: Vector3, b: Vector3, box: number, run: number): number {
  const cands = streetOf(p, i).runs[run]!
  const radius = radiusOf(p, i, view)
  for (let k = 0; k < cands.length; k++) {
    if (shows(cands[k]!, anchor, view, radius, a)) box = candidateBoxes(p, i, anchor, view, a, b, box, run, k)
  }
  return box
}

/**
 * A street's candidates: first its run with the most on-screen candidates within the radius (last placement's run
 * while it has at most one fewer, so the label doesn't hop between carriageways), then its other runs by count, so
 * the label falls back to another run when the first has no room. A street an earlier station's label already names
 * (the same `streetKey`) gets none: one label per street in view. Returns the next free box.
 */
export function streetBoxes(p: LabelPlacement, i: number, view: PlacementView, a: Vector3, b: Vector3, box: number): number {
  const runs = streetOf(p, i).runs
  const anchor = p.stations[p.stationOf[i]!]!.layer.anchor
  p.cand.start[i] = box
  p.cand.size[i] = 0
  p.prefer[i] = -1
  if (p.keyPlaced[p.keyId[i]!] === 1) return box
  const radius = radiusOf(p, i, view)
  let best = -1
  for (let r = 0; r < runs.length; r++) {
    let count = 0
    for (let k = 0; k < runs[r]!.length; k++) if (shows(runs[r]![k]!, anchor, view, radius, a)) count++
    p.runCount[r] = count
    p.runDone[r] = 0
    if (count > 0 && (best < 0 || count > p.runCount[best]!)) best = r
  }
  const last = p.lastRun[i]!
  const keep = !view.fresh || p.lastFirst[i]
  if (keep && best >= 0 && last >= 0 && last < runs.length && p.runCount[last]! >= Math.max(p.runCount[best]! - 1, 1)) best = last
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

/** Marks station `s`'s streets a placed entrance label of it names (`named`). */
export function markNamedStreets(p: LabelPlacement, s: number): void {
  const streets = p.segStreet0[s]!
  p.named.fill(0, streets, p.segEnd[s]!)
  for (let i = p.segItem0[s]!; i < streets; i++) {
    if (p.out[i]! < 0) continue
    const named = entranceOf(p, i).streets
    for (let k = 0; k < named.length; k++) p.named[streets + named[k]!] = 1
  }
}

/** Orders station `s`'s streets (order positions segStreet0 to segEnd - 1): for the focused station those a placed
 *  entrance label names first, for a budgeted one those it doesn't (its few labels name more streets), then the
 *  rest; within each, last placement's winners first, then by length (their index order). */
export function rankStreets(p: LabelPlacement, s: number, budgeted: boolean): void {
  const first = p.segStreet0[s]!
  const end = p.segEnd[s]!
  let r = first
  for (let tier = 0; tier < 4; tier++) {
    const named = (tier < 2) !== budgeted ? 1 : 0
    const placed = tier % 2 === 0
    for (let i = first; i < end; i++) {
      if (p.named[i] === named && (p.lastSrc[i]! >= 0) === placed) p.cand.order[r++] = i
    }
  }
}

/** Records the street keys station `s`'s placed street labels name, so later stations' copies get no candidates; a
 *  leaving station claims none. */
export function markPlacedKeys(p: LabelPlacement, s: number): void {
  if (p.leaving[s] === 1) return
  for (let i = p.segStreet0[s]!; i < p.segEnd[s]!; i++) if (p.out[i]! >= 0) p.keyPlaced[p.keyId[i]!] = 1
}
