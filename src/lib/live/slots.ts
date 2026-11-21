import { hopDistance } from '../realtime/position'
import type { LiveTrip } from '../realtime/prepareTrips'
import { SMOOTHING, smoothDistance, type SmoothingParams } from '../realtime/smoothing'
import { POLL_MS } from './backoff'
import { decideCorrection } from './motion'

/** About 340 trips are live at once; this leaves headroom, and overflow is counted, never silent. */
export const TRAIN_CAPACITY = 1024
/** Seconds a dot takes to scale in or out (and each half of a cross-fade). */
export const FADE_S = 0.4
/** A trip missing from a poll is kept, moving on its old plan, this long before it fades. */
export const GRACE_S = POLL_MS / 1000

/** Reconcile decides every correction, so the per-frame ease never snaps or holds on its own. */
const FRAME_SMOOTHING: SmoothingParams = { ...SMOOTHING, snapM: Infinity, holdBackM: Infinity }

/** Cross-fade phases: shrinking at the old position, then growing at the new one. */
const SHRINK = 1
const GROW = 2

/**
 * Stable instance slots for live trips, keyed by `LiveTrip.key`. Plain mutable arrays (no React or
 * three.js): a slot keeps its instance, color and displayed distance across polls, and a trip that
 * vanishes fades out before its slot is freed.
 */
export interface SlotTable {
  keys: (string | null)[]
  trips: (LiveTrip | null)[]
  byKey: Map<string, number>
  /** When the slot's dot started fading in (any monotone seconds; the caller uses one clock). */
  bornAt: Float64Array
  /** When it starts fading out; NaN while the trip is present. Set a grace period ahead when it goes missing. */
  leavingSince: Float64Array
  /** Smoothed distance along the shape; NaN means "no value yet" (the next frame takes the target). */
  displayed: Float64Array
  /** A glide closes `glideE0` meters over `glideT` seconds of the live clock starting at `glideAt`; glideT NaN means none. */
  glideE0: Float64Array
  glideAt: Float64Array
  glideT: Float64Array
  /** Cross-fade phase (0 none, SHRINK, GROW) and when it began. */
  phase: Uint8Array
  phaseAt: Float64Array
  /** One past the highest slot ever used; per-frame loops stop here. */
  high: number
}

export function createSlotTable(capacity: number): SlotTable {
  return {
    keys: new Array<string | null>(capacity).fill(null),
    trips: new Array<LiveTrip | null>(capacity).fill(null),
    byKey: new Map(),
    bornAt: new Float64Array(capacity),
    leavingSince: new Float64Array(capacity).fill(NaN),
    displayed: new Float64Array(capacity).fill(NaN),
    glideE0: new Float64Array(capacity),
    glideAt: new Float64Array(capacity),
    glideT: new Float64Array(capacity).fill(NaN),
    phase: new Uint8Array(capacity),
    phaseAt: new Float64Array(capacity),
    high: 0,
  }
}

const smoothstep = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1)
  return t * t * (3 - 2 * t)
}

export const isLeaving = (t: SlotTable, i: number): boolean => !Number.isNaN(t.leavingSince[i]!)

export interface ReconcileOptions {
  /** Live-clock epoch seconds, to evaluate the new plans at. */
  dataNow: number
  reducedMotion: boolean
  fadeS?: number
  graceS?: number
}

/** Chooses how a persisting trip absorbs its new plan (see motion.ts) and records it on the slot. */
function absorbPlan(t: SlotTable, slot: number, trip: LiveTrip, reshaped: boolean, nowS: number, o: ReconcileOptions): void {
  const shown = t.displayed[slot]!
  t.glideT[slot] = NaN
  if (Number.isNaN(shown) || t.phase[slot] !== 0) return
  const { plan, geometry } = trip
  const target = hopDistance(plan, geometry, o.dataNow)
  const c = decideCorrection({
    errM: target - shown,
    remainingM: geometry.stopDistances[plan.to]! - shown,
    timeToArriveS: plan.fixedFraction === null && plan.arriveAt !== null ? plan.arriveAt - o.dataNow : null,
    reshaped,
    reducedMotion: o.reducedMotion,
  })
  if (c.kind === 'crossfade') {
    t.phase[slot] = SHRINK
    t.phaseAt[slot] = nowS
  } else if (c.kind === 'glide') {
    t.glideE0[slot] = target - shown
    t.glideAt[slot] = o.dataNow
    t.glideT[slot] = c.durationS
  }
}

/**
 * Applies a new poll: a present key keeps its slot (absorbing its new plan without a jump), a new key
 * takes the lowest free slot, a missing key keeps moving for a grace period and then starts leaving, and a
 * returning key stops leaving without a visible pop. `needsColor` lists the slots whose instance color must
 * be (re)written. Allocates; runs once per poll.
 */
export function reconcileSlots(
  t: SlotTable,
  trips: readonly LiveTrip[],
  nowS: number,
  o: ReconcileOptions,
): { needsColor: number[]; overflow: number } {
  const fadeS = o.fadeS ?? FADE_S
  const graceS = o.graceS ?? GRACE_S
  const needsColor: number[] = []
  let overflow = 0
  const present = new Set<string>()

  for (const trip of trips) {
    present.add(trip.key)
    const slot = t.byKey.get(trip.key)
    if (slot !== undefined) {
      const reshaped = t.trips[slot]!.shapeId !== trip.shapeId
      if (reshaped) needsColor.push(slot)
      t.trips[slot] = trip
      absorbPlan(t, slot, trip, reshaped, nowS, o)
      if (isLeaving(t, slot)) {
        // Continue from the scale it has now, so a returning trip doesn't pop.
        t.bornAt[slot] = nowS - (1 - (nowS - t.leavingSince[slot]!) / fadeS) * fadeS
        t.leavingSince[slot] = NaN
      }
      continue
    }
    const free = t.keys.indexOf(null)
    if (free < 0) {
      overflow++
      continue
    }
    t.keys[free] = trip.key
    t.trips[free] = trip
    t.byKey.set(trip.key, free)
    t.bornAt[free] = nowS
    t.leavingSince[free] = NaN
    t.displayed[free] = NaN
    t.glideT[free] = NaN
    t.phase[free] = 0
    t.high = Math.max(t.high, free + 1)
    needsColor.push(free)
  }

  for (const [key, slot] of t.byKey) {
    if (!present.has(key) && !isLeaving(t, slot)) t.leavingSince[slot] = nowS + graceS
  }
  return { needsColor, overflow }
}

/** Releases a slot (after its fade-out). No allocation. */
export function freeSlot(t: SlotTable, i: number): void {
  const key = t.keys[i]
  if (key !== null && key !== undefined) t.byKey.delete(key)
  t.keys[i] = null
  t.trips[i] = null
  t.leavingSince[i] = NaN
  t.displayed[i] = NaN
  t.glideT[i] = NaN
  t.phase[i] = 0
}

/**
 * The slot's displayed distance for this frame, stored back on the table. `target` is the plan's
 * distance at `dataNow` (live clock); `localS` is the monotone clock of the fades. No allocation.
 */
export function stepSlot(t: SlotTable, i: number, target: number, dataNow: number, localS: number, dtS: number, fadeS: number = FADE_S): number {
  if (t.phase[i] === SHRINK && localS - t.phaseAt[i]! >= fadeS) {
    // Fully shrunk: move unseen, then grow at the new position.
    t.phase[i] = GROW
    t.phaseAt[i] = localS
    t.displayed[i] = NaN
    t.glideT[i] = NaN
  } else if (t.phase[i] === GROW && localS - t.phaseAt[i]! >= fadeS) {
    t.phase[i] = 0
  }
  const prev = t.displayed[i]!
  let shown: number
  if (Number.isNaN(prev)) shown = target
  else if (t.phase[i] === SHRINK) shown = prev
  else if (!Number.isNaN(t.glideT[i]!)) {
    const u = (dataNow - t.glideAt[i]!) / t.glideT[i]!
    if (u >= 1) {
      t.glideT[i] = NaN
      shown = smoothDistance(prev, target, dtS, FRAME_SMOOTHING)
    } else {
      shown = Math.max(prev, target - t.glideE0[i]! * (1 - u))
    }
  } else shown = smoothDistance(prev, target, dtS, FRAME_SMOOTHING)
  t.displayed[i] = shown
  return shown
}

/** Dot scale 0..1: fades in from `bornAt`, out from `leavingSince`, and through a cross-fade. */
export function slotScale(t: SlotTable, i: number, nowS: number, fadeS: number = FADE_S): number {
  let k = smoothstep((nowS - t.bornAt[i]!) / fadeS)
  if (isLeaving(t, i)) k = Math.min(k, smoothstep(1 - (nowS - t.leavingSince[i]!) / fadeS))
  const phase = t.phase[i]
  if (phase === SHRINK) k *= smoothstep(1 - (nowS - t.phaseAt[i]!) / fadeS)
  else if (phase === GROW) k *= smoothstep((nowS - t.phaseAt[i]!) / fadeS)
  return k
}
