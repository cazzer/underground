import type { Ground } from './projection'

/** A pick within this many screen pixels of a station's center selects it (a touch-sized target). */
export const STATION_HIT_PX = 22
/** A pick within this many pixels of a train's dot, or of the line through its cars, selects it. */
export const TRAIN_HIT_PX = 16
/** A fingertip gets the station-sized target for trains when no station is within reach of it. */
export const TRAIN_TOUCH_HIT_PX = 22
/** A station wins a pick unless a train is at least this many pixels closer to the pointer. */
export const STATION_PRIORITY_PX = 6

/** Canvas pixels, origin top left. */
export interface ScreenPoint {
  x: number
  y: number
}

/** Projects a scene point to canvas pixels into `out`; returns false (out unspecified) when it is behind the camera. */
export type ToScreen = (x: number, y: number, z: number, out: ScreenPoint) => boolean

export interface PickHit {
  index: number
  distancePx: number
}

export type ScenePick = { kind: 'station'; index: number } | { kind: 'train'; index: number }

/** Distance from `p` to the segment a-b, in pixels. A zero-length segment is its point. */
export function segmentDistancePx(p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1) : 0
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

const center: ScreenPoint = { x: 0, y: 0 }
const edge: ScreenPoint = { x: 0, y: 0 }

/**
 * The station whose center projects nearest the click, within its target: `hitPx`, or the marker as drawn
 * when that is bigger (`radiusM(i)`, meters on the ground, measured on screen along x). Null if none. Nearest
 * on screen decides, so overlapping targets at the overview pick the one the pointer is closest to.
 */
export function nearestStation(
  positions: readonly Ground[],
  toScreen: ToScreen,
  click: ScreenPoint,
  radiusM: (i: number) => number,
  hitPx: number = STATION_HIT_PX,
): PickHit | null {
  let best: PickHit | null = null
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!
    if (!toScreen(p.x, 0, p.z, center)) continue
    const d = Math.hypot(center.x - click.x, center.y - click.y)
    if (best !== null && d >= best.distancePx) continue
    let reach = hitPx
    if (d > hitPx) {
      if (!toScreen(p.x + radiusM(i), 0, p.z, edge)) continue
      reach = Math.max(hitPx, Math.hypot(edge.x - center.x, edge.y - center.y))
    }
    if (d <= reach) best = { index: i, distancePx: d }
  }
  return best
}

/**
 * The train target for a pick: a touch with no station in reach gets the bigger one. The open station
 * (`focusedIndex`) draws no marker, so it doesn't count: a tap on a train at its platform gets the bigger one too.
 */
export function trainHitPx(touch: boolean, station: PickHit | null, focusedIndex = -1): number {
  return touch && (station === null || station.index === focusedIndex) ? TRAIN_TOUCH_HIT_PX : TRAIN_HIT_PX
}

/**
 * Station or train: the station wins ties and near-ties, so station picks keep working where trains run
 * through. When the station is the one already open (`focusedIndex`), any train in reach wins instead: the
 * station's panel is up, so a second click there means the train waiting at it.
 */
export function choosePick(station: PickHit | null, train: PickHit | null, focusedIndex = -1): ScenePick | null {
  if (train && (!station || station.index === focusedIndex || train.distancePx <= station.distancePx - STATION_PRIORITY_PX)) {
    return { kind: 'train', index: train.index }
  }
  return station ? { kind: 'station', index: station.index } : null
}
