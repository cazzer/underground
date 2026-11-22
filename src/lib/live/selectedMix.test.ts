import { describe, expect, it } from 'vitest'
import { SELECTED_CARS_AT_M } from './consist'
import {
  createSelectedMix,
  forgetSlot,
  SELECT_EASE_S,
  selectedMixActive,
  selectSlot,
  slotMix,
  stepSelectedMix,
  type SelectedMix,
} from './selectedMix'

/** 5 km: every other train is a dot (carMix 0), the selected one is fully cars. */
const FAR = 5000

function stepFor(s: SelectedMix, seconds: number, reduced = false): void {
  for (let t = 0; t < seconds - 1e-9; t += 0.05) stepSelectedMix(s, FAR, 0.05, reduced)
}

describe('selectedMix', () => {
  it('passes every slot through at the shared mix while nothing is selected', () => {
    const s = createSelectedMix()
    stepSelectedMix(s, FAR, 0.1, false)
    expect(slotMix(s, 3, 0)).toBe(0)
    expect(slotMix(s, 3, 0.4)).toBe(0.4)
    expect(selectedMixActive(s)).toBe(false)
  })

  it('eases the selected slot onto its target over SELECT_EASE_S, leaving the others alone', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepSelectedMix(s, FAR, 0, false)
    expect(slotMix(s, 2, 0)).toBe(0)
    stepFor(s, SELECT_EASE_S / 2)
    expect(slotMix(s, 2, 0)).toBeCloseTo(0.5, 6)
    expect(selectedMixActive(s)).toBe(true)
    stepFor(s, SELECT_EASE_S / 2)
    expect(slotMix(s, 2, 0)).toBe(1)
    expect(slotMix(s, 5, 0)).toBe(0)
  })

  it('folds the previous selection back while the new one unfolds', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepFor(s, SELECT_EASE_S)
    selectSlot(s, 7, true)
    expect(s.prevSlot).toBe(2)
    stepFor(s, SELECT_EASE_S / 2)
    expect(slotMix(s, 2, 0)).toBeCloseTo(0.5, 6)
    expect(slotMix(s, 7, 0)).toBeCloseTo(0.5, 6)
    stepFor(s, SELECT_EASE_S / 2)
    expect(slotMix(s, 2, 0)).toBe(0)
    expect(s.prevSlot).toBe(-1)
  })

  it('deselecting folds the train back, and the cars stay on until it is a dot', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepFor(s, SELECT_EASE_S)
    selectSlot(s, -1, true)
    stepFor(s, SELECT_EASE_S / 4)
    expect(slotMix(s, 2, 0)).toBeGreaterThan(0.5)
    expect(selectedMixActive(s)).toBe(true)
    stepFor(s, SELECT_EASE_S)
    expect(slotMix(s, 2, 0)).toBe(0)
    expect(selectedMixActive(s)).toBe(false)
  })

  it('keeps folding a deselected train back when another is selected mid-fold', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepFor(s, SELECT_EASE_S)
    selectSlot(s, -1, true)
    stepFor(s, SELECT_EASE_S / 4)
    const folding = slotMix(s, 2, 0)
    expect(folding).toBeGreaterThan(0.5)
    selectSlot(s, 7, false)
    expect(slotMix(s, 2, 0)).toBeCloseTo(folding, 6)
    stepFor(s, SELECT_EASE_S / 4)
    expect(slotMix(s, 2, 0)).toBeLessThan(folding)
    expect(slotMix(s, 2, 0)).toBeGreaterThan(0)
    expect(slotMix(s, 7, 0)).toBeGreaterThan(0)
    stepFor(s, SELECT_EASE_S)
    expect(slotMix(s, 2, 0)).toBe(0)
    expect(slotMix(s, 7, 0)).toBe(1)
  })

  it('drops the old slot at once when it now holds another trip', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepFor(s, SELECT_EASE_S)
    selectSlot(s, -1, false)
    expect(slotMix(s, 2, 0)).toBe(0)
    expect(selectedMixActive(s)).toBe(false)
  })

  it('picks up from the fold when the previous slot is reselected', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepFor(s, SELECT_EASE_S)
    selectSlot(s, -1, true)
    stepFor(s, SELECT_EASE_S / 4)
    const folding = slotMix(s, 2, 0)
    selectSlot(s, 2, true)
    expect(slotMix(s, 2, 0)).toBeCloseTo(folding, 6)
  })

  it('forgets a freed slot, selected or folding back', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepFor(s, SELECT_EASE_S)
    forgetSlot(s, 2)
    expect(s.slot).toBe(-1)
    expect(slotMix(s, 2, 0)).toBe(0)
    selectSlot(s, 4, true)
    stepFor(s, SELECT_EASE_S)
    selectSlot(s, 5, true)
    forgetSlot(s, 4)
    expect(s.prevSlot).toBe(-1)
    expect(slotMix(s, 4, 0)).toBe(0)
  })

  it('snaps under reduced motion', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepSelectedMix(s, FAR, 0.016, true)
    expect(slotMix(s, 2, 0)).toBe(1)
    selectSlot(s, -1, true)
    stepSelectedMix(s, FAR, 0.016, true)
    expect(slotMix(s, 2, 0)).toBe(0)
  })

  it('never draws the selected train below the shared mix, and follows the target with zoom', () => {
    const s = createSelectedMix()
    selectSlot(s, 2, true)
    stepFor(s, SELECT_EASE_S)
    stepSelectedMix(s, 30_000, 0, false)
    expect(slotMix(s, 2, 0)).toBe(0)
    expect(selectedMixActive(s)).toBe(false)
    stepSelectedMix(s, SELECTED_CARS_AT_M, 0, false)
    expect(slotMix(s, 2, 0)).toBeCloseTo(1, 12)
    stepSelectedMix(s, 1000, 0, false)
    expect(slotMix(s, 2, 1)).toBe(1)
  })
})
