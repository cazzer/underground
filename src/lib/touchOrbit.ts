/**
 * Two-finger touch orbit: which way a two-finger gesture goes, and how far it turns the view.
 *
 * A gesture starts when a touch makes exactly two fingers down. It stays `pending` until it locks: to `zoom` once
 * the spread changes by SPREAD_LOCK (checked first, so it wins a tie), or, only while turning is armed, to `rotate`
 * once the fingers twist by TWIST_LOCK or their midpoint slides SLIDE_LOCK_PX plus however much the spread changed (a
 * pinch drifts its midpoint, so the slide's dead zone widens with it). A third finger, any lift or a cancel ends
 * it; only a later touch that makes exactly two fingers down starts the next one, from their live positions.
 *
 * Under a rotate lock the turn is the twist (the finger pair's screen angle, y down, so a clockwise twist is
 * positive) plus the slide as the controls turn it (-2π · dx / height). The lock hands over the whole turn since
 * the gesture started, so nothing the fingers did before it is lost. Allocation-free after `createTouchOrbit`.
 */

export type TouchLock = 'none' | 'pending' | 'zoom' | 'rotate'

/** Pinch ratio (either way) that locks a gesture to zoom. */
export const SPREAD_LOCK = 1.15
/** Twist (radians) that locks an armed gesture to rotate: 12°. */
export const TWIST_LOCK = (12 * Math.PI) / 180
/** Midpoint slide (px), on top of the spread's change, that locks an armed gesture to rotate. */
export const SLIDE_LOCK_PX = 40

const CAPACITY = 10
const LN_SPREAD_LOCK = Math.log(SPREAD_LOCK)
const TWO_PI = 2 * Math.PI

export interface TouchOrbit {
  ids: Int32Array
  xs: Float64Array
  ys: Float64Array
  /** Fingers down (and tracked). */
  count: number
  lock: TouchLock
  /** Spread and midpoint x at the gesture's start. */
  spread0: number
  mid0: number
  /** The pair's angle and midpoint x at the last move. */
  angle: number
  mid: number
  /** Twist since the gesture's start (unwrapped). */
  twist: number
  /** Turn not yet taken: twist (radians) and midpoint slide (px). */
  dueTwist: number
  dueSlide: number
}

export function createTouchOrbit(): TouchOrbit {
  return {
    ids: new Int32Array(CAPACITY),
    xs: new Float64Array(CAPACITY),
    ys: new Float64Array(CAPACITY),
    count: 0,
    lock: 'none',
    spread0: 0,
    mid0: 0,
    angle: 0,
    mid: 0,
    twist: 0,
    dueTwist: 0,
    dueSlide: 0,
  }
}

/** An angle step wrapped into (-π, π]. */
export function wrapAngle(a: number): number {
  const w = a - TWO_PI * Math.floor((a + Math.PI) / TWO_PI)
  return w === -Math.PI ? Math.PI : w
}

function slotOf(t: TouchOrbit, id: number): number {
  for (let i = 0; i < t.count; i++) if (t.ids[i] === id) return i
  return -1
}

function pairAngle(t: TouchOrbit): number {
  return Math.atan2(t.ys[1]! - t.ys[0]!, t.xs[1]! - t.xs[0]!)
}

function pairSpread(t: TouchOrbit): number {
  return Math.hypot(t.xs[1]! - t.xs[0]!, t.ys[1]! - t.ys[0]!)
}

function pairMid(t: TouchOrbit): number {
  return (t.xs[0]! + t.xs[1]!) / 2
}

function end(t: TouchOrbit): void {
  t.lock = 'none'
  t.dueTwist = 0
  t.dueSlide = 0
}

export function touchDown(t: TouchOrbit, id: number, x: number, y: number): void {
  const known = slotOf(t, id)
  if (known >= 0) {
    t.xs[known] = x
    t.ys[known] = y
    return
  }
  if (t.count >= CAPACITY) {
    end(t)
    return
  }
  t.ids[t.count] = id
  t.xs[t.count] = x
  t.ys[t.count] = y
  t.count++
  if (t.count !== 2) {
    end(t)
    return
  }
  t.lock = 'pending'
  t.spread0 = pairSpread(t)
  t.mid0 = t.mid = pairMid(t)
  t.angle = pairAngle(t)
  t.twist = 0
  t.dueTwist = 0
  t.dueSlide = 0
}

/** A finger moved; `armed` says whether the gesture may turn the view now. */
export function touchMove(t: TouchOrbit, id: number, x: number, y: number, armed: boolean): void {
  const i = slotOf(t, id)
  if (i < 0) return
  t.xs[i] = x
  t.ys[i] = y
  if (t.lock !== 'pending' && t.lock !== 'rotate') return
  const angle = pairAngle(t)
  const step = wrapAngle(angle - t.angle)
  const mid = pairMid(t)
  const slide = mid - t.mid
  t.angle = angle
  t.mid = mid
  t.twist += step
  if (t.lock === 'rotate') {
    if (!armed) return
    t.dueTwist += step
    t.dueSlide += slide
    return
  }
  t.dueTwist += step
  t.dueSlide += slide
  const spread = pairSpread(t)
  if (t.spread0 > 0 && Math.abs(Math.log(spread / t.spread0)) >= LN_SPREAD_LOCK) {
    t.lock = 'zoom'
    t.dueTwist = 0
    t.dueSlide = 0
    return
  }
  if (!armed) return
  const slid = Math.abs(mid - t.mid0)
  if (Math.abs(t.twist) >= TWIST_LOCK || slid >= SLIDE_LOCK_PX + Math.abs(spread - t.spread0)) t.lock = 'rotate'
}

export function touchUp(t: TouchOrbit, id: number): void {
  const i = slotOf(t, id)
  if (i < 0) return
  t.ids.copyWithin(i, i + 1, t.count)
  t.xs.copyWithin(i, i + 1, t.count)
  t.ys.copyWithin(i, i + 1, t.count)
  t.count--
  end(t)
}

/** The turn (radians, azimuth) since the last call, for an element `heightPx` tall; 0 unless locked to rotate. */
export function takeTurn(t: TouchOrbit, heightPx: number): number {
  if (t.lock !== 'rotate') return 0
  const turn = t.dueTwist - (heightPx > 0 ? (TWO_PI * t.dueSlide) / heightPx : 0)
  t.dueTwist = 0
  t.dueSlide = 0
  return turn
}

/**
 * An azimuth goal held inside the controls' window. An open window (either bound infinite) leaves the goal
 * unwrapped; a finite one, which lies within [-π, π], wraps it there first.
 */
export function clampAzimuth(v: number, min: number, max: number): number {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return v
  const w = wrapAngle(v)
  return Math.max(min, Math.min(max, w))
}
