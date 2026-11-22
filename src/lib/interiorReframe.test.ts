import { describe, expect, it } from 'vitest'
import { reframeAction, reframeDuration, REFRAME_MAX_S, REFRAME_MIN_S, type ReframeInput } from './interiorReframe'

const landed: ReframeInput = { flying: false, following: false, focusedId: 'L08', interiorId: 'L08' }
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
    expect(reframeAction(awaiting, { ...landed, interiorId: null })).toBe('wait')
    // A stale interior of the station before is not this one.
    expect(reframeAction(awaiting, { ...landed, interiorId: 'L06' })).toBe('wait')
  })

  it('drops the reframe when focus moves on or a train is followed, even mid-flight', () => {
    expect(reframeAction(awaiting, { ...landed, focusedId: null })).toBe('drop')
    expect(reframeAction(awaiting, { ...landed, focusedId: 'L06', interiorId: 'L06' })).toBe('drop')
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
