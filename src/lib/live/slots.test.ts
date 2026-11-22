import { describe, expect, it } from 'vitest'
import { buildPolyline, pointAtDistance } from '../realtime/polyline'
import type { HopPlan } from '../realtime/position'
import type { LiveTrip } from '../realtime/prepareTrips'
import type { ShapeGeometry } from '../realtime/shapeGeometry'
import { EMPTY_PROFILE } from '../trackProfile'
import { GLIDE_CATCHUP_MPS, GLIDE_MAX_S } from './motion'
import { createSlotTable, freeSlot, isLeaving, reconcileSlots, slotScale, stepSlot, type ReconcileOptions, type SlotTable } from './slots'

const FADE = 0.4
const GRACE = 20
const DT = 1 / 60
const O: ReconcileOptions = { dataNow: 1000, reducedMotion: false, fadeS: FADE, graceS: GRACE }

/** A north-south shape 2000 m long at east offset `x`, with stops at 0, 1000 and 2000 m. */
function shape(shapeId: string, x = 0): ShapeGeometry {
  return {
    shapeId,
    line: buildPolyline([{ x, z: 0 }, { x, z: -1000 }, { x, z: -2000 }]),
    stops: ['a', 'b', 'c'],
    stopDistances: [0, 1000, 2000],
    maxStopOffsetM: 0,
    profile: EMPTY_PROFILE,
    bandInputs: new Float32Array(0),
  }
}
const SHAPES: Record<string, ShapeGeometry> = { S1: shape('S1'), S1b: shape('S1b', 10), S2: shape('S2', 500) }

/** A trip arriving at stop `to` (default 1, at 1000 m) at `arriveAt` after a 100 s hop, or fixed at `fixed` of the hop. */
function trip(key: string, over: { shapeId?: string; arriveAt?: number; fixed?: number; to?: number } = {}): LiveTrip {
  const plan: HopPlan = {
    from: 0,
    to: over.to ?? 1,
    arriveAt: over.fixed === undefined ? (over.arriveAt ?? 1100) : null,
    runS: 100,
    dwellS: 0,
    fixedFraction: over.fixed ?? null,
    minFraction: 0,
    departsInS: null,
    capped: false,
    rampShare: 0,
  }
  const shapeId = over.shapeId ?? 'S1'
  return { key, shapeId, plan, geometry: SHAPES[shapeId]! } as unknown as LiveTrip
}
const opts = (over: Partial<ReconcileOptions> = {}): ReconcileOptions => ({ ...O, ...over })

describe('reconcileSlots', () => {
  it('gives new keys the lowest free slots and asks for their colors', () => {
    const t = createSlotTable(4)
    const r = reconcileSlots(t, [trip('a'), trip('b')], 10, O)
    expect(r).toEqual({ needsColor: [0, 1], overflow: 0 })
    expect(t.byKey.get('b')).toBe(1)
    expect(t.high).toBe(2)
    expect(t.drawGeometry[1]).toBe(SHAPES.S1)
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
    expect(t.drawGeometry[0]).toBeNull()
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
  /** Where the dot is drawn on the ground. */
  const drawn = (t: SlotTable, shown: number) => pointAtDistance(t.drawGeometry[0]!.line, shown).point

  const dist = (now: number) => 1000 - Math.min(1, (1060 - now) / 100) * 1000 // due at 1000 m at 1060, 100 s run

  it('glides forward to catch up with the train within seconds, never going back', () => {
    // Showing 100 m while the train is at 400 m: a 300 m gap closes in 5 s, not over the rest of the hop.
    const t = corrected(100, trip('a', { arriveAt: 1060 }))
    expect(t.glideT[0]).toBe(300 / GLIDE_CATCHUP_MPS)
    let prev = 100
    let maxStep = 0
    for (let now = 1000; now <= 1006; now += DT) {
      const shown = stepSlot(t, 0, dist(now), now, 20 + (now - 1000), DT, FADE)
      expect(shown).toBeGreaterThanOrEqual(prev)
      maxStep = Math.max(maxStep, shown - prev)
      prev = shown
    }
    expect(maxStep / DT).toBeLessThanOrEqual(1.5 * GLIDE_CATCHUP_MPS + 10 + 1) // the train's 10 m/s plus the eased peak
    expect(dist(1006) - prev).toBeLessThan(10)
  })

  it('hands a finished glide over to the ease without a step', () => {
    const t = corrected(100, trip('a', { arriveAt: 1060 }))
    let prev = 100
    for (let now = 1000; now < 1004.9; now += DT) prev = stepSlot(t, 0, dist(now), now, 20 + (now - 1000), DT, FADE)
    expect(Number.isNaN(t.glideT[0]!)).toBe(false)
    // Frames either side of u = 1: the glide ends exactly on the target, so the ease takes over from it.
    const before = stepSlot(t, 0, dist(1004.99), 1004.99, 24.99, DT, FADE)
    const at = stepSlot(t, 0, dist(1005), 1005, 25, DT, FADE)
    const after = stepSlot(t, 0, dist(1005 + DT), 1005 + DT, 25 + DT, DT, FADE)
    expect(Number.isNaN(t.glideT[0]!)).toBe(true)
    expect(Math.abs(at - before)).toBeLessThan(1)
    expect(Math.abs(after - at)).toBeLessThan(1)
    expect(prev).toBeLessThan(dist(1005))
  })

  it('continues a running glide when the next poll lands mid-glide, instead of restarting it', () => {
    const t = corrected(100, trip('a', { arriveAt: 1060 }))
    for (let now = 1000; now < 1002; now += DT) stepSlot(t, 0, dist(now), now, 20 + (now - 1000), DT, FADE)
    // Same plan at 1002: the remaining gap needs less than the 3 s left, so the end holds. 900 m ahead needs longer.
    reconcileSlots(t, [trip('a', { arriveAt: 1060 })], 22, opts({ dataNow: 1002 }))
    expect(t.glideAt[0]! + t.glideT[0]!).toBeCloseTo(1005, 5)
    const far = corrected(100, trip('a', { arriveAt: 1060 }))
    reconcileSlots(far, [trip('a', { arriveAt: 1052, to: 2 })], 22, opts({ dataNow: 1002 }))
    expect(far.glideT[0]).toBe(GLIDE_MAX_S)
  })

  it('carries a dot over to a shape that passes close by, drawing the same spot', () => {
    const t = corrected(500, trip('a', { shapeId: 'S1b', arriveAt: 1050 }))
    expect(t.phase[0]).toBe(0)
    expect(t.drawGeometry[0]).toBe(SHAPES.S1b)
    expect(t.displayed[0]).toBeCloseTo(500)
    const p = drawn(t, t.displayed[0]!)
    expect(Math.hypot(p.x - 0, p.z - -500)).toBeLessThanOrEqual(10)
  })

  it('cross-fades a shape that is far away: shrinks in place on the old shape, moves unseen, then grows', () => {
    const t = corrected(500, trip('a', { shapeId: 'S2', fixed: 0.5 }))
    const start = 20
    expect(t.phase[0]).toBe(1)
    expect(t.drawGeometry[0]).toBe(SHAPES.S1)
    const spot = drawn(t, t.displayed[0]!)

    // Shrinking: the dot has not moved.
    expect(stepSlot(t, 0, 500, 1000, start + 0.1, DT, FADE)).toBe(500)
    expect(drawn(t, 500)).toEqual(spot)
    expect(slotScale(t, 0, start + FADE / 2, FADE)).toBeCloseTo(0.5)
    expect(slotScale(t, 0, start + FADE, FADE)).toBeCloseTo(0)

    // Fully shrunk: the draw shape switches with the move, so the drawn point only changes at scale 0.
    const at = start + FADE + 0.001
    expect(slotScale(t, 0, at, FADE)).toBeLessThan(0.001)
    stepSlot(t, 0, 500, 1000, at, DT, FADE)
    expect(t.phase[0]).toBe(2)
    expect(t.drawGeometry[0]).toBe(SHAPES.S2)
    expect(drawn(t, t.displayed[0]!).x).toBe(500)
    expect(slotScale(t, 0, at + FADE / 2, FADE)).toBeCloseTo(0.5, 1)

    stepSlot(t, 0, 500, 1000, start + 2 * FADE + 0.01, DT, FADE)
    expect(t.phase[0]).toBe(0)
    expect(slotScale(t, 0, start + 2 * FADE + 0.01, FADE)).toBe(1)
  })

  it('draws a continuous point across a shape change: no visible jump at any frame', () => {
    for (const to of ['S1b', 'S2']) {
      const t = createSlotTable(1)
      reconcileSlots(t, [trip('a', { fixed: 0.5 })], 10, O)
      t.displayed[0] = 500
      reconcileSlots(t, [trip('a', { shapeId: to, fixed: 0.5 })], 20, O)
      let last = drawn(t, 500)
      for (let s = 20; s < 21.5; s += DT) {
        const shown = stepSlot(t, 0, 500, 1000, s, DT, FADE)
        const p = drawn(t, shown)
        // A jump is only allowed while the dot is invisible.
        if (slotScale(t, 0, s, FADE) > 0.02) expect(Math.hypot(p.x - last.x, p.z - last.z), `${to} @${s.toFixed(2)}`).toBeLessThan(25)
        last = p
      }
    }
  })

  it('restarts the shrink from the current scale when the shape changes again mid-grow', () => {
    const t = corrected(500, trip('a', { shapeId: 'S2', fixed: 0.5 }))
    stepSlot(t, 0, 500, 1000, 20 + FADE + 0.001, DT, FADE) // now growing on S2
    const growAt = 20 + FADE + 0.001
    const midGrow = growAt + FADE / 4
    const scaleBefore = slotScale(t, 0, midGrow, FADE)
    reconcileSlots(t, [trip('a', { shapeId: 'S1', fixed: 0.5 })], midGrow, O)
    expect(t.phase[0]).toBe(1)
    expect(t.drawGeometry[0]).toBe(SHAPES.S2)
    expect(slotScale(t, 0, midGrow, FADE)).toBeCloseTo(scaleBefore)
  })

  it('keeps shrinking on the old shape when another poll lands mid-shrink', () => {
    const t = corrected(500, trip('a', { shapeId: 'S2', fixed: 0.5 }))
    const mid = 20 + FADE / 2
    reconcileSlots(t, [trip('a', { shapeId: 'S2', fixed: 0.5 })], mid, O)
    expect(t.phase[0]).toBe(1)
    expect(t.phaseAt[0]).toBe(20)
    expect(t.drawGeometry[0]).toBe(SHAPES.S1)
    expect(t.displayed[0]).toBe(500)
  })

  it('holds a backward revision for a moving plan, and cross-fades one past the limit', () => {
    // Showing 900 m while a moving plan says 0 m: wait for it.
    expect(corrected(900, trip('a', { arriveAt: 1100 })).phase[0]).toBe(0)
    expect(corrected(1500, trip('a', { arriveAt: 1100 })).phase[0]).toBe(0)
    expect(corrected(1600, trip('a', { arriveAt: 1100 })).phase[0]).toBe(1)
  })

  it('cross-fades a backward revision against a plan that is not moving', () => {
    expect(corrected(1400, trip('a', { fixed: 0.5 })).phase[0]).toBe(1) // 900 m back, and it would never catch up
    expect(corrected(600, trip('a', { fixed: 0.5 })).phase[0]).toBe(0) // 100 m back
  })

  it('cross-fades every large forward correction under reduced motion', () => {
    expect(corrected(0, trip('a', { arriveAt: 1050 }), opts({ reducedMotion: true })).phase[0]).toBe(1)
  })

  it('takes the target for a slot with no displayed distance yet', () => {
    const t = createSlotTable(1)
    reconcileSlots(t, [trip('a')], 10, O)
    expect(stepSlot(t, 0, 321, 1000, 10, DT, FADE)).toBe(321)
  })

  it('leaves a poll that arrives mid cross-fade to the fade already running', () => {
    const t = corrected(500, trip('a', { shapeId: 'S2', fixed: 0.5 }))
    const phaseAt = t.phaseAt[0]
    reconcileSlots(t, [trip('a', { shapeId: 'S2', fixed: 0.9 })], 20 + FADE / 2, O)
    expect(t.phase[0]).toBe(1)
    expect(t.phaseAt[0]).toBe(phaseAt)
    expect(Number.isNaN(t.glideT[0]!)).toBe(true)
  })
})
