import { describe, expect, it } from 'vitest'
import type { LiveTrip } from '../realtime/prepareTrips'
import { createSlotTable, freeSlot, isLeaving, reconcileSlots, slotScale } from './slots'

const trip = (key: string, shapeId = 'S1'): LiveTrip => ({ key, shapeId }) as LiveTrip
const FADE = 0.4

describe('reconcileSlots', () => {
  it('gives new keys the lowest free slots and asks for their colors', () => {
    const t = createSlotTable(4)
    const r = reconcileSlots(t, [trip('a'), trip('b')], 10)
    expect(r).toEqual({ needsColor: [0, 1], overflow: 0 })
    expect(t.byKey.get('b')).toBe(1)
    expect(t.high).toBe(2)
  })

  it('keeps a persisting key in its slot and swaps in the new trip', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a'), trip('b')], 10)
    t.displayed[1] = 500
    const next = trip('b')
    const r = reconcileSlots(t, [next], 20)
    expect(r.needsColor).toEqual([])
    expect(t.trips[1]).toBe(next)
    expect(t.displayed[1]).toBe(500)
  })

  it('resets the displayed distance and asks for a new color when the shape changes', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a', 'S1')], 10)
    t.displayed[0] = 500
    expect(reconcileSlots(t, [trip('a', 'S2')], 20).needsColor).toEqual([0])
    expect(t.displayed[0]).toBeNaN()
  })

  it('starts a missing key leaving once, and un-leaves it when it returns', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a')], 10)
    reconcileSlots(t, [], 20)
    expect(t.leavingSince[0]).toBe(20)
    reconcileSlots(t, [], 25)
    expect(t.leavingSince[0]).toBe(20)
    reconcileSlots(t, [trip('a')], 20.1)
    expect(isLeaving(t, 0)).toBe(false)
    expect(t.byKey.get('a')).toBe(0)
  })

  it('does not pop when a leaving key returns', () => {
    const t = createSlotTable(2)
    reconcileSlots(t, [trip('a')], 10)
    reconcileSlots(t, [], 20)
    const before = slotScale(t, 0, 20.1, FADE)
    reconcileSlots(t, [trip('a')], 20.1, FADE)
    expect(slotScale(t, 0, 20.1, FADE)).toBeCloseTo(before)
    expect(slotScale(t, 0, 20.1 + FADE, FADE)).toBe(1)
  })

  it('reuses a freed slot, lowest first', () => {
    const t = createSlotTable(4)
    reconcileSlots(t, [trip('a'), trip('b'), trip('c')], 10)
    freeSlot(t, 1)
    freeSlot(t, 0)
    expect(t.byKey.has('a')).toBe(false)
    expect(reconcileSlots(t, [trip('c'), trip('d')], 30).needsColor).toEqual([0])
    expect(t.byKey.get('d')).toBe(0)
  })

  it('counts trips that do not fit', () => {
    const t = createSlotTable(2)
    expect(reconcileSlots(t, [trip('a'), trip('b'), trip('c'), trip('d')], 10).overflow).toBe(2)
    expect(t.byKey.size).toBe(2)
  })
})

describe('slotScale', () => {
  it('fades in over fadeS', () => {
    const t = createSlotTable(1)
    reconcileSlots(t, [trip('a')], 10)
    expect(slotScale(t, 0, 10, FADE)).toBe(0)
    expect(slotScale(t, 0, 10 + FADE / 2, FADE)).toBeCloseTo(0.5)
    expect(slotScale(t, 0, 10 + FADE, FADE)).toBe(1)
    expect(slotScale(t, 0, 99, FADE)).toBe(1)
  })

  it('fades out over fadeS and ends at 0', () => {
    const t = createSlotTable(1)
    reconcileSlots(t, [trip('a')], 10)
    reconcileSlots(t, [], 20)
    expect(slotScale(t, 0, 20, FADE)).toBe(1)
    expect(slotScale(t, 0, 20 + FADE / 2, FADE)).toBeCloseTo(0.5)
    expect(slotScale(t, 0, 20 + FADE, FADE)).toBeCloseTo(0)
    expect(slotScale(t, 0, 20 + FADE + 0.01, FADE)).toBe(0)
  })
})
