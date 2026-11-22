import { describe, expect, it } from 'vitest'
import { interiorReadyFor, reframeAction, reframeDuration, REFRAME_MAX_S, REFRAME_MIN_S, type ReframeInput } from './interiorReframe'

const landed: ReframeInput = { flying: false, following: false, focusedId: 'L08', interiorReady: true }
const awaiting = { stationId: 'L08', reduced: false }

describe('reframeAction', () => {
  it('reframes once the flight has landed and its interior is known', () => {
    expect(reframeAction(awaiting, landed)).toBe('reframe')
  })

  it('snaps without a turn under reduced motion', () => {
    expect(reframeAction({ stationId: 'L08', reduced: true }, landed)).toBe('snap')
  })

  it('waits while the flight is under way or the interior has not arrived', () => {
    expect(reframeAction(awaiting, { ...landed, flying: true })).toBe('wait')
    // A stale interior of another station is not ready: interiorCovers decides that (interiorComplex.test.ts).
    expect(reframeAction(awaiting, { ...landed, interiorReady: false })).toBe('wait')
  })

  it('reframes for a complex member the interior covers, whichever member awaited it', () => {
    // The caller decides interiorReady with interiorCovers; the awaited station is the focused member, not the file id.
    expect(reframeAction({ stationId: 'U01', reduced: false }, { ...landed, focusedId: 'U01' })).toBe('reframe')
    expect(reframeAction({ stationId: 'U01', reduced: false }, { ...landed, focusedId: 'T01' })).toBe('drop')
  })

  it('drops the reframe when focus moves on or a train is followed, even mid-flight', () => {
    expect(reframeAction(awaiting, { ...landed, focusedId: null })).toBe('drop')
    expect(reframeAction(awaiting, { ...landed, focusedId: 'L06' })).toBe('drop')
    expect(reframeAction(awaiting, { ...landed, following: true })).toBe('drop')
    expect(reframeAction(awaiting, { ...landed, following: true, flying: true })).toBe('drop')
  })

  it('does nothing when no flight is awaiting an interior (a gesture or a new flight cleared it)', () => {
    expect(reframeAction(null, landed)).toBe('none')
  })
})

describe('reframeDuration', () => {
  it('skips a reframe with nothing to move', () => {
    expect(reframeDuration(0, 0)).toBeNull()
    expect(reframeDuration(0.2, 0.001)).toBeNull()
  })

  it('grows with the bigger of pan and turn, within 0.6 to 1 s', () => {
    expect(reframeDuration(1, 0)).toBeCloseTo(REFRAME_MIN_S, 1)
    expect(reframeDuration(40, 0)).toBeCloseTo(0.8)
    expect(reframeDuration(0, -Math.PI / 4)).toBeCloseTo(0.8)
    expect(reframeDuration(40, Math.PI / 2)).toBe(REFRAME_MAX_S)
    expect(reframeDuration(500, 3)).toBe(REFRAME_MAX_S)
  })
})

describe('interiorReadyFor', () => {
  const complex = { stationId: 'T01', memberStationIds: ['T01', 'U01'] }

  it('is ready when the loaded interior covers the awaited station, whichever member it was', () => {
    expect(interiorReadyFor({ stationId: 'U01', reduced: false }, complex)).toBe(true)
    expect(interiorReadyFor({ stationId: 'L08', reduced: false }, { stationId: 'L08' })).toBe(true)
  })

  it('is not ready for no awaiting flight, no interior, or the interior of another station', () => {
    expect(interiorReadyFor(null, complex)).toBe(false)
    expect(interiorReadyFor({ stationId: 'U01', reduced: false }, null)).toBe(false)
    expect(interiorReadyFor({ stationId: 'L08', reduced: false }, complex)).toBe(false)
  })
})
