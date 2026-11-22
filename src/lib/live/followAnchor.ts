/**
 * The selected train's drawn point, written once per frame before the camera moves (LiveTrains' -3 frame), so the
 * follow can aim at where the train is drawn: on its band, at its track's height, plus any shape-change carry. Pure,
 * no allocation.
 */
import type { BandView } from '../bandOffset'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { carryInto } from './shapeCarry'
import type { SlotTable } from './slots'
import { trackPointInto, type TrackPoint } from './trackPoint'

/**
 * A move along the shape this big in one frame is a discontinuity (a cross-fade's unseen move, a frame after a hidden
 * tab), not travel: no train covers 60 m in a frame.
 */
export const ANCHOR_CUT_M = 60

export interface FollowAnchor extends TrackPoint {
  /** The slot written, -1 for none. */
  slot: number
  /** False when there is no point to follow: no selected slot, or its slot has no distance or shape yet. */
  valid: boolean
  /**
   * True on a frame where the point moved discontinuously: it just became valid, changed slot or shape, or its
   * distance jumped by ANCHOR_CUT_M. The follow eases over such a move instead of jumping with it.
   */
  cut: boolean
  /** The shape and distance last written, to detect a cut. */
  geometry: ShapeGeometry | null
  distance: number
}

export function createFollowAnchor(): FollowAnchor {
  return { x: 0, y: 0, z: 0, slot: -1, valid: false, cut: false, geometry: null, distance: NaN }
}

/**
 * Writes slot `slot`'s drawn point (as the dots and cars draw it this frame: its displayed distance along its draw
 * geometry in `view`, plus the carry offset at `localS`) into `a`. `scratch` takes the carry offset.
 */
export function writeFollowAnchor(a: FollowAnchor, table: SlotTable, slot: number, view: BandView, localS: number, scratch: TrackPoint): FollowAnchor {
  const geometry = slot < 0 ? null : table.drawGeometry[slot]
  const distance = slot < 0 ? NaN : table.displayed[slot]!
  if (!geometry || Number.isNaN(distance)) {
    a.slot = slot
    a.valid = false
    a.cut = false
    a.geometry = null
    a.distance = NaN
    return a
  }
  a.cut = !a.valid || a.slot !== slot || a.geometry !== geometry || !(Math.abs(distance - a.distance) < ANCHOR_CUT_M)
  trackPointInto(geometry, distance, view, a)
  carryInto(table.carry, slot, localS, scratch)
  a.x += scratch.x
  a.y += scratch.y
  a.z += scratch.z
  a.slot = slot
  a.valid = true
  a.geometry = geometry
  a.distance = distance
  return a
}
