import { segmentDistancePx, TRAIN_HIT_PX, type PickHit, type ScreenPoint, type ToScreen } from '../pick'
import type { Ground } from '../projection'
import { pointAtDistanceInto, type Polyline } from '../realtime/polyline'
import type { Consist } from './consist'
import { consistSpanInto, type ConsistSpan } from './consistLayout'
import { isLeaving, slotScale, type SlotTable } from './slots'

/** A slot faded below this scale (arriving or cross-fading) can't be picked: it is barely drawn. */
const MIN_PICK_SCALE = 0.5

/** What the live layer publishes for picks: its slot table (stepped every frame) and each slot's consist. */
export interface TrainPickSource {
  table: SlotTable
  consistOf: (slot: number) => Consist
  /** Height the dots and the car floors are drawn at. */
  y: number
  /** Car body height this frame at full unfold, before the slot's fade (it grows with crossScale far out). */
  carHeightM: () => number
}

export interface TrainPickInput extends TrainPickSource {
  /** carMix at the current camera distance: 0 dots, 1 cars. */
  mix: number
  /** The fades' clock (performance.now() seconds). */
  localS: number
}

const ground: Ground = { x: 0, z: 0 }
const span: ConsistSpan = { cars: 0, pitch: 0, step: 0, rear: 0 }
const prev: ScreenPoint = { x: 0, y: 0 }
const next: ScreenPoint = { x: 0, y: 0 }

/** Pixel distance from the click to the polyline through a train's car ends, Infinity if none of it is in front of the camera. */
function consistDistancePx(line: Polyline, shown: number, consist: Consist, mixK: number, y: number, toScreen: ToScreen, click: ScreenPoint): number {
  consistSpanInto(span, line.length, shown, consist, mixK)
  let best = Infinity
  let havePrev = false
  for (let c = 0; c <= span.cars; c++) {
    pointAtDistanceInto(line, span.rear + c * span.step, ground)
    const ok = toScreen(ground.x, y, ground.z, next)
    if (ok && havePrev) best = Math.min(best, segmentDistancePx(click, prev, next))
    havePrev = ok
    prev.x = next.x
    prev.y = next.y
  }
  return best
}

/**
 * The train drawn nearest the click, within `hitPx` of its dot or, once cars unfold (mix > 0), of the
 * chord lines through its car ends at floor and roof height, laid out exactly as writeConsist draws them. Skips empty, leaving,
 * not yet placed and mostly faded slots. Returns the slot. Reads the table as of the last frame; no allocation
 * beyond the result.
 */
export function nearestTrain(src: TrainPickInput, toScreen: ToScreen, click: ScreenPoint, hitPx: number = TRAIN_HIT_PX): PickHit | null {
  const { table, mix, localS, y } = src
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < table.high; i++) {
    if (!table.trips[i] || isLeaving(table, i)) continue
    const shown = table.displayed[i]!
    const geometry = table.drawGeometry[i]
    if (Number.isNaN(shown) || !geometry || geometry.line.points.length === 0) continue
    const k = slotScale(table, i, localS)
    if (k < MIN_PICK_SCALE) continue
    pointAtDistanceInto(geometry.line, shown, ground)
    let d = toScreen(ground.x, y, ground.z, next) ? Math.hypot(next.x - click.x, next.y - click.y) : Infinity
    if (mix > 0) {
      // The floor line and the roof line, so at a tilt the whole side of a car is a target.
      const consist = src.consistOf(i)
      const roof = y + src.carHeightM() * k * Math.min(1, 4 * mix)
      d = Math.min(d, consistDistancePx(geometry.line, shown, consist, mix * k, y, toScreen, click))
      d = Math.min(d, consistDistancePx(geometry.line, shown, consist, mix * k, roof, toScreen, click))
    }
    if (d <= hitPx && d < bestD) {
      best = i
      bestD = d
    }
  }
  return best < 0 ? null : { index: best, distancePx: bestD }
}

/** Screen points of a slot's dot and, with cars unfolded, its rear and front car ends; null if it isn't drawn or is behind the camera. */
export function trainScreenPoints(
  src: TrainPickInput,
  slot: number,
  toScreen: ToScreen,
): { dot: ScreenPoint; rear: ScreenPoint | null; front: ScreenPoint | null } | null {
  const { table, mix, localS, y } = src
  const shown = table.displayed[slot]
  const geometry = table.drawGeometry[slot]
  if (shown === undefined || Number.isNaN(shown) || !geometry || geometry.line.points.length === 0) return null
  const at = (distance: number): ScreenPoint | null => {
    pointAtDistanceInto(geometry.line, distance, ground)
    const out = { x: 0, y: 0 }
    return toScreen(ground.x, y, ground.z, out) ? out : null
  }
  const dot = at(shown)
  if (!dot) return null
  if (mix === 0) return { dot, rear: null, front: null }
  consistSpanInto(span, geometry.line.length, shown, src.consistOf(slot), mix * slotScale(table, slot, localS))
  const { rear, cars, step } = span
  return { dot, rear: at(rear), front: at(rear + cars * step) }
}
