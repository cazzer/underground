import { describe, expect, it } from 'vitest'
import type { HopPlan } from '../realtime/position'
import type { LiveTrip } from '../realtime/prepareTrips'
import { createSlotTable, freeSlot, isLeaving, reconcileSlots, slotScale, stepSlot, type ReconcileOptions } from './slots'

const FADE = 0.4
const GRACE = 20
const DT = 1 / 60
const geometry = { stopDistances: [0, 1000, 2000] } as unknown as LiveTrip['geometry']
const O: ReconcileOptions = { dataNow: 1000, reducedMotion: false, fadeS: FADE, graceS: GRACE }

/** A trip arriving at stop 1 (1000 m) at `arriveAt` after a 100 s hop, or fixed at `fixed` of the hop. */
function trip(key: string, over: { shapeId?: string; arriveAt?: number; fixed?: number } = {}): LiveTrip {
  const plan: HopPlan = {
    from: 0,
    to: 1,
    arriveAt: over.fixed === undefined ? (over.arriveAt ?? 1100) : null,
    runS: 100,
    fixedFraction: over.fixed ?? null,
    minFraction: 0,
    departsInS: null,
  }
  return { key, shapeId: over.shapeId ?? 'S1', plan, geometry } as LiveTrip
}
const opts = (over: Partial<ReconcileOptions> = {}): ReconcileOptions => ({ ...O, ...over })

describe('reconcileSlots', () => {
  it('gives new keys the lowest free slots and asks for their colors', () => {
    const t = createSlotTable(4)
    const r = reconcileSlots(t, [trip('a'), trip('b')], 10, O)
    expect(r).toEqual({ needsColor: [0, 1], overflow: 0 })
    expect(t.byKey.get('b')).toBe(1)
    expect(t.high).toBe(2)
  })

  it('keeps a persisting key in its slot and swaps in the new trip', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a'), trip('b')], 10, O)
    t.displayed[1] = 500
    const next = trip('b')
    expect(reconcileSlots(t, [next], 20, O).needsColor).toEqual([])
    expect(t.trips[1]).toBe(next)
    expect(t.displayed[1]).toBe(500)
  })

  it('asks for a new color and cross-fades when the shape changes', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a', { shapeId: 'S1' })], 10, O)
    t.displayed[0] = 500
    expect(reconcileSlots(t, [trip('a', { shapeId: 'S2' })], 20, O).needsColor).toEqual([0])
    expect(t.phase[0]).toBe(1)
    expect(t.displayed[0]).toBe(500)
  })

  it('keeps a missing key moving for the grace period, then fades it', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a')], 10, O)
    reconcileSlots(t, [], 20, O)
    expect(t.leavingSince[0]).toBe(20 + GRACE)
    expect(slotScale(t, 0, 20 + GRACE, FADE)).toBe(1)
    expect(slotScale(t, 0, 20 + GRACE + FADE / 2, FADE)).toBeCloseTo(0.5)
    reconcileSlots(t, [], 25, O)
    expect(t.leavingSince[0]).toBe(20 + GRACE)
  })

  it('keeps the displayed distance when a graced trip returns', () => {
    const t = createSlotTable(2)
    reconcileSlots(t, [trip('a')], 10, O)
    t.displayed[0] = 400
    reconcileSlots(t, [], 20, O)
    reconcileSlots(t, [trip('a')], 40, O)
    expect(isLeaving(t, 0)).toBe(false)
    expect(t.displayed[0]).toBe(400)
    expect(slotScale(t, 0, 40, FADE)).toBe(1)
  })

  it('does not pop when a trip returns mid fade-out', () => {
    const t = createSlotTable(2)
    reconcileSlots(t, [trip('a')], 10, O)
    reconcileSlots(t, [], 20, opts({ graceS: 0 }))
    const before = slotScale(t, 0, 20.1, FADE)
    reconcileSlots(t, [trip('a')], 20.1, O)
    expect(slotScale(t, 0, 20.1, FADE)).toBeCloseTo(before)
    expect(slotScale(t, 0, 20.1 + FADE, FADE)).toBe(1)
  })

  it('reuses a freed slot, lowest first', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a'), trip('b'), trip('c')], 10, O)
    freeSlot(t, 1)
    freeSlot(t, 0)
    expect(t.byKey.has('a')).toBe(false)
    expect(reconcileSlots(t, [trip('c'), trip('d')], 30, O).needsColor).toEqual([0])
    expect(t.byKey.get('d')).toBe(0)
  })

  it('counts trips that do not fit', () => {
    const t = createSlotTable(2)
    expect(reconcileSlots(t, [trip('a'), trip('b'), trip('c'), trip('d')], 10, O).overflow).toBe(2)
    expect(t.byKey.size).toBe(2)
  })
})

describe('slotScale', () => {
  it('fades in over fadeS', () => {
    const t = createSlotTable(1)
    reconcileSlots(t, [trip('a')], 10, O)
    expect(slotScale(t, 0, 10, FADE)).toBe(0)
    expect(slotScale(t, 0, 10 + FADE / 2, FADE)).toBeCloseTo(0.5)
    expect(slotScale(t, 0, 10 + FADE, FADE)).toBe(1)
  })

  it('fades out over fadeS and ends at 0', () => {
    const t = createSlotTable(1)
    reconcileSlots(t, [trip('a')], 10, O)
    reconcileSlots(t, [], 20, opts({ graceS: 0 }))
    expect(slotScale(t, 0, 20, FADE)).toBe(1)
    expect(slotScale(t, 0, 20 + FADE / 2, FADE)).toBeCloseTo(0.5)
    expect(slotScale(t, 0, 20 + FADE + 0.01, FADE)).toBe(0)
  })
})

describe('corrections', () => {
  /** A slot already showing `shown` m when a new poll says the train is at `plan`. */
  function corrected(shown: number, next: LiveTrip, o: ReconcileOptions = O) {
    const t = createSlotTable(1)
    reconcileSlots(t, [trip('a')], 10, O)
    t.displayed[0] = shown
    reconcileSlots(t, [next], 20, o)
    return t
  }

  it('glides forward so the train reaches the stop at its arrival time, never going back', () => {
    // Showing 100 m; the new plan has the train arriving at 1000 m in 60 s, so it is already near 400 m.
    const t = corrected(100, trip('a', { arriveAt: 1060 }))
    expect(t.glideT[0]).toBe(60)
    const dist = (now: number) => 1000 - Math.min(1, (1060 - now) / 100) * 1000 // target at 1000 m over a 100 s run
    let prev = 100
    let maxStep = 0
    for (let now = 1000; now <= 1060; now += DT) {
      const shown = stepSlot(t, 0, dist(now), now, 20 + (now - 1000), DT, FADE)
      expect(shown).toBeGreaterThanOrEqual(prev)
      maxStep = Math.max(maxStep, shown - prev)
      prev = shown
    }
    expect(maxStep / DT).toBeLessThanOrEqual(30)
    expect(prev).toBeCloseTo(1000, -1)
  })

  it('cross-fades a shape change: shrinks in place, moves unseen, then grows', () => {
    const t = corrected(500, trip('a', { shapeId: 'S2', fixed: 1 }))
    expect(t.phase[0]).toBe(1)
    const start = 20
    expect(stepSlot(t, 0, 1000, 1000, start + 0.1, DT, FADE)).toBe(500)
    expect(slotScale(t, 0, start + FADE / 2, FADE)).toBeCloseTo(0.5)
    expect(slotScale(t, 0, start + FADE, FADE)).toBeCloseTo(0)
    expect(stepSlot(t, 0, 1000, 1000, start + FADE + 0.001, DT, FADE)).toBe(1000)
    expect(t.phase[0]).toBe(2)
    expect(slotScale(t, 0, start + FADE + 0.001 + FADE / 2, FADE)).toBeCloseTo(0.5, 2)
    stepSlot(t, 0, 1000, 1000, start + 2 * FADE + 0.01, DT, FADE)
    expect(t.phase[0]).toBe(0)
    expect(slotScale(t, 0, start + 2 * FADE + 0.01, FADE)).toBe(1)
  })

  it('cross-fades a forward error that would need a faster train than the limit', () => {
    // Showing 0 m, the train is due at 1000 m in 20 s (50 m/s).
    expect(corrected(0, trip('a', { arriveAt: 1020 })).phase[0]).toBe(1)
  })

  it('holds a small backward revision and cross-fades a large one', () => {
    expect(corrected(1400, trip('a', { fixed: 0.5 })).phase[0]).toBe(0) // 900 m back
    expect(corrected(1500, trip('a', { fixed: 0 })).phase[0]).toBe(0) // 1500 m back
    expect(corrected(1600, trip('a', { fixed: 0 })).phase[0]).toBe(1)
  })

  it('cross-fades every large forward correction under reduced motion', () => {
    expect(corrected(0, trip('a', { arriveAt: 1050 }), opts({ reducedMotion: true })).phase[0]).toBe(1)
  })

  it('takes the target for a slot with no displayed distance yet', () => {
    const t = createSlotTable(1)
    reconcileSlots(t, [trip('a')], 10, O)
    expect(stepSlot(t, 0, 321, 1000, 10, DT, FADE)).toBe(321)
  })
})
