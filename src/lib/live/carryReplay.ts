/** Shape-change replays shared by the shapeCarry tests: the app's camera, screen pixels, and a slot moved between shapes. */
import { PerspectiveCamera } from 'three'
import { createBandView, writeBandView, type BandView } from '../bandOffset'
import type { HopPlan } from '../realtime/position'
import type { LiveTrip } from '../realtime/prepareTrips'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { depthFactor, tiltForDistance } from '../tilt'
import { addCarry, CARRY_MAX_S } from './shapeCarry'
import { createSlotTable, reconcileSlots, stepSlot, type SlotTable } from './slots'
import { createTrackPoint, nearestOnTrack, trackPointInto, type TrackPoint } from './trackPoint'

const H = 844
export const PITCH = 2.5
const DT = 1 / 60

/** The app's camera at `distance` from `target`, tilted by the zoom (tilt.ts), looking north. */
export function viewAt(target: { x: number; z: number }, distance: number): BandView {
  const cam = new PerspectiveCamera(35, 390 / H, 10, 1e7)
  const polar = Math.max(tiltForDistance(distance), 1e-4)
  cam.position.set(target.x, distance * Math.cos(polar), target.z + distance * Math.sin(polar))
  cam.lookAt(target.x, 0, target.z)
  cam.updateMatrixWorld()
  const e = cam.matrixWorldInverse.elements
  return writeBandView(createBandView(), e, cam.projectionMatrix.elements[5]!, H, distance, PITCH, 4.7, 1, depthFactor(distance))
}

/** Screen position (CSS px from the view center) of a world point in `v`. */
export function toPx(v: BandView, p: TrackPoint): [number, number] {
  const e = v.view
  const w = -(e[2]! * p.x + e[6]! * p.y + e[10]! * p.z + e[14]!)
  return [(e[0]! * p.x + e[4]! * p.y + e[8]! * p.z + e[12]!) / w / v.k, (e[1]! * p.x + e[5]! * p.y + e[9]! * p.z + e[13]!) / w / v.k]
}

export const pxApart = (v: BandView, a: TrackPoint, b: TrackPoint): number => {
  const [ax, ay] = toPx(v, a)
  const [bx, by] = toPx(v, b)
  return Math.hypot(ax - bx, ay - by)
}

/** Where slot 0 is drawn now: its shape's drawn point plus the offset easing out, as LiveTrains draws it. */
export function drawnAt(t: SlotTable, v: BandView, nowS: number): TrackPoint {
  const p = trackPointInto(t.drawGeometry[0]!, t.displayed[0]!, v, createTrackPoint())
  addCarry(t.carry, 0, nowS, p, createTrackPoint())
  return p
}

/** A trip on `geometry` held at `distance` (a fixed plan between its two stops), so only the shape change moves it. */
export function heldTrip(geometry: ShapeGeometry, distance: number): LiveTrip {
  const plan: HopPlan = {
    from: 0,
    to: 1,
    arriveAt: null,
    runS: 100,
    dwellS: 0,
    fixedFraction: distance / geometry.line.length,
    minFraction: 0,
    departsInS: null,
    capped: false,
    eased: false,
  }
  return { key: 'a', shapeId: geometry.shapeId, plan, geometry } as unknown as LiveTrip
}

/**
 * Replays a shape change: slot 0 drawn at `shown` on `from`, then a poll moves it to `to`, held where it carried
 * over. Returns the jump the poll makes on screen, the largest per-frame step until the offset has eased out, and
 * where it ends against `to`'s drawn line.
 */
export function replay(from: ShapeGeometry, shown: number, to: ShapeGeometry, v: BandView, reducedMotion = false) {
  const t = createSlotTable(1)
  reconcileSlots(t, [heldTrip(from, shown)], 0, { dataNow: 0, reducedMotion: false, view: v })
  t.displayed[0] = shown
  const before = drawnAt(t, v, 10)
  const hit = nearestOnTrack(to, before, v, { distance: 0, offsetM: 0 })
  reconcileSlots(t, [heldTrip(to, hit.distance)], 10, { dataNow: 0, reducedMotion, view: v })
  const carried = t.phase[0] === 0 && t.drawGeometry[0] === to
  const offset = !Number.isNaN(t.carry.at[0]!)
  let last = drawnAt(t, v, 10)
  const jumpPx = pxApart(v, before, last)
  // A cross-fade shrinks in place on the old shape and moves unseen: no steps to measure.
  if (!carried) return { jumpPx, stepPx: 0, endPx: 0, carried, offset }
  let stepPx = 0
  for (let s = 10 + DT; s < 10 + CARRY_MAX_S + 2 * DT; s += DT) {
    stepSlot(t, 0, hit.distance, 0, s, DT)
    const p = drawnAt(t, v, s)
    stepPx = Math.max(stepPx, pxApart(v, last, p))
    last = p
  }
  const end = trackPointInto(to, t.displayed[0]!, v, createTrackPoint())
  return { jumpPx, stepPx, endPx: pxApart(v, last, end), carried, offset }
}
