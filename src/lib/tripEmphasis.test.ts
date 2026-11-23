import { describe, expect, it } from 'vitest'
import { createEmphasis, createLevels, EMPHASIS_S, emphasisLevels, stepEmphasis, type EmphasisLook } from './tripEmphasis'

const LOOK: EmphasisLook = { lineWidth: 1.5, tripLineWidth: 2.5, tripNetworkDim: 0.7, tripFaintDim: 0.35 }
const levelsOf = (shown: number, full: number) => emphasisLevels({ shown, full }, LOOK, createLevels(LOOK))

describe('emphasisLevels', () => {
  it('dims nothing and draws the trip at the base width when not shown', () => {
    expect(levelsOf(0, 1)).toEqual({ networkDim: 0, tripDim: 0, tripWidthPx: 1.5, tripVisible: false, tripOpacity: 0 })
    expect(levelsOf(0, 0)).toEqual({ networkDim: 0, tripDim: 0, tripWidthPx: 1.5, tripVisible: false, tripOpacity: 0 })
  })

  it('dims the network and draws an opened journey full and wide', () => {
    expect(levelsOf(1, 1)).toEqual({ networkDim: 0.7, tripDim: 0, tripWidthPx: 2.5, tripVisible: true, tripOpacity: 1 })
  })

  it('draws the list view faint at the base width', () => {
    expect(levelsOf(1, 0)).toEqual({ networkDim: 0.7, tripDim: 0.35, tripWidthPx: 1.5, tripVisible: true, tripOpacity: 1 })
  })

  it('moves monotonically as it eases in', () => {
    let last = levelsOf(0, 1)
    for (let i = 1; i <= 20; i++) {
      const next = levelsOf(i / 20, 1)
      expect(next.networkDim).toBeGreaterThanOrEqual(last.networkDim)
      expect(next.tripWidthPx).toBeGreaterThanOrEqual(last.tripWidthPx)
      expect(next.tripOpacity).toBeGreaterThanOrEqual(last.tripOpacity)
      last = next
    }
  })
})

describe('stepEmphasis', () => {
  it('eases toward the target over EMPHASIS_S, holding the look while hidden', () => {
    const e = createEmphasis()
    const dt = EMPHASIS_S / 4
    stepEmphasis(e, { shown: true, full: true }, dt, false)
    expect(e).toEqual({ shown: 0.25, full: 0.25 })
    for (let i = 0; i < 3; i++) stepEmphasis(e, { shown: true, full: true }, dt, false)
    expect(e).toEqual({ shown: 1, full: 1 })
    stepEmphasis(e, { shown: true, full: true }, dt, false)
    expect(e).toEqual({ shown: 1, full: 1 })
    stepEmphasis(e, { shown: false, full: false }, dt, false)
    expect(e).toEqual({ shown: 0.75, full: 1 })
  })

  it('snaps under reduced motion', () => {
    const e = createEmphasis()
    stepEmphasis(e, { shown: true, full: false }, 0.001, true)
    expect(e).toEqual({ shown: 1, full: 0 })
  })

  it('counts a long frame as a short one and ignores a negative one', () => {
    const e = createEmphasis()
    stepEmphasis(e, { shown: true, full: true }, 5, false)
    expect(e.shown).toBeCloseTo(0.1 / EMPHASIS_S, 9)
    stepEmphasis(e, { shown: true, full: true }, -1, false)
    expect(e.shown).toBeCloseTo(0.1 / EMPHASIS_S, 9)
  })
})
