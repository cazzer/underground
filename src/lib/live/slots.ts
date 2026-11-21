import type { LiveTrip } from '../realtime/prepareTrips'

/** About 340 trips are live at once; this leaves headroom, and overflow is counted, never silent. */
export const TRAIN_CAPACITY = 1024
/** Seconds a dot takes to scale in or out. */
export const FADE_S = 0.4

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
  /** When it started fading out; NaN while the trip is present. */
  leavingSince: Float64Array
  /** Smoothed distance along the shape; NaN means "no value yet" (the next frame snaps to the target). */
  displayed: Float64Array
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
    high: 0,
  }
}

const smoothstep = (x: number): number => {
  const t = Math.min(Math.max(x, 0), 1)
  return t * t * (3 - 2 * t)
}

export const isLeaving = (t: SlotTable, i: number): boolean => !Number.isNaN(t.leavingSince[i]!)

/**
 * Applies a new poll: a present key keeps its slot (and snaps when its shape changed), a new key takes
 * the lowest free slot, a missing key starts leaving, and a returning key stops leaving without a
 * visible pop. `needsColor` lists the slots whose instance color must be (re)written. Allocates;
 * runs once per poll.
 */
export function reconcileSlots(
  t: SlotTable,
  trips: readonly LiveTrip[],
  nowS: number,
  fadeS: number = FADE_S,
): { needsColor: number[]; overflow: number } {
  const needsColor: number[] = []
  let overflow = 0
  const present = new Set<string>()

  for (const trip of trips) {
    present.add(trip.key)
    const slot = t.byKey.get(trip.key)
    if (slot !== undefined) {
      if (t.trips[slot]!.shapeId !== trip.shapeId) {
        t.displayed[slot] = NaN
        needsColor.push(slot)
      }
      t.trips[slot] = trip
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
    t.high = Math.max(t.high, free + 1)
    needsColor.push(free)
  }

  for (const [key, slot] of t.byKey) {
    if (!present.has(key) && !isLeaving(t, slot)) t.leavingSince[slot] = nowS
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
}

/** Dot scale 0..1: smoothstep in from `bornAt`, smoothstep out from `leavingSince` (whichever is smaller). */
export function slotScale(t: SlotTable, i: number, nowS: number, fadeS: number = FADE_S): number {
  const born = smoothstep((nowS - t.bornAt[i]!) / fadeS)
  return isLeaving(t, i) ? Math.min(born, smoothstep(1 - (nowS - t.leavingSince[i]!) / fadeS)) : born
}
