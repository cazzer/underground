import { describe, expect, it } from 'vitest'
import type { IndexLoad } from '../data/interiorLoad'
import {
  classifyAwaiting,
  frameReadyFor,
  interiorReadyFor,
  nextAwaiting,
  reframeAction,
  reframeDuration,
  stationIsBare,
  streetsMissingFor,
  streetsReadyFor,
  REFRAME_MAX_S,
  REFRAME_MIN_S,
  type ReframeInput,
} from './interiorReframe'

const landed: ReframeInput = { flying: false, following: false, focusedId: 'L08', ready: true, missing: false }
const awaiting = { stationId: 'L08', kind: 'interior' as const, reduced: false }

describe('reframeAction', () => {
  it('reframes once the flight has landed and its interior is known', () => {
    expect(reframeAction(awaiting, landed)).toBe('reframe')
  })

  it('snaps without a turn under reduced motion', () => {
    expect(reframeAction({ stationId: 'L08', kind: 'interior' as const, reduced: true }, landed)).toBe('snap')
  })

  it('waits while the flight is under way or the interior has not arrived', () => {
    expect(reframeAction(awaiting, { ...landed, flying: true })).toBe('wait')
    // A stale interior of another station is not ready: interiorCovers decides that (interiorComplex.test.ts).
    expect(reframeAction(awaiting, { ...landed, ready: false })).toBe('wait')
  })

  it('reframes for a complex member the interior covers, whichever member awaited it', () => {
    // The caller decides ready with interiorCovers; the awaited station is the focused member, not the file id.
    expect(reframeAction({ stationId: 'U01', kind: 'interior' as const, reduced: false }, { ...landed, focusedId: 'U01' })).toBe('reframe')
    expect(reframeAction({ stationId: 'U01', kind: 'interior' as const, reduced: false }, { ...landed, focusedId: 'T01' })).toBe('drop')
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
    expect(interiorReadyFor({ stationId: 'U01', kind: 'interior' as const, reduced: false }, complex)).toBe(true)
    expect(interiorReadyFor({ stationId: 'L08', kind: 'interior' as const, reduced: false }, { stationId: 'L08' })).toBe(true)
  })

  it('is not ready for no awaiting flight, no interior, or the interior of another station', () => {
    expect(interiorReadyFor(null, complex)).toBe(false)
    expect(interiorReadyFor({ stationId: 'U01', kind: 'interior' as const, reduced: false }, null)).toBe(false)
    expect(interiorReadyFor({ stationId: 'L08', kind: 'interior' as const, reduced: false }, complex)).toBe(false)
  })
})

describe('streetsReadyFor', () => {
  const bare = { stationId: '127', kind: 'streets' as const, reduced: false }

  it("is ready once the awaited bare station's streets have loaded", () => {
    expect(streetsReadyFor(bare, { stationId: '127' })).toBe(true)
  })

  it('is not ready for no awaiting flight, no streets, another station, or a flight awaiting an interior', () => {
    expect(streetsReadyFor(null, { stationId: '127' })).toBe(false)
    expect(streetsReadyFor(bare, null)).toBe(false)
    expect(streetsReadyFor(bare, { stationId: '725' })).toBe(false)
    expect(streetsReadyFor({ ...bare, kind: 'interior' }, { stationId: '127' })).toBe(false)
  })

  it('leaves a flight awaiting streets unready for any interior', () => {
    expect(interiorReadyFor(bare, { stationId: '127' })).toBe(false)
  })
})

describe('a bare station found out after the flight set off', () => {
  const loading: IndexLoad = { status: 'loading' }
  const ready: IndexLoad = { status: 'ready', index: { stations: { L08: { provenance: 'authored' }, U01: { provenance: 'generated', file: 'T01' } } } }
  const deepLink = { stationId: '127', kind: 'interior' as const, reduced: false }

  it('is bare only once the index has loaded and does not list it', () => {
    expect(stationIsBare('127', ready)).toBe(true)
    expect(stationIsBare('127', loading)).toBe(false)
    expect(stationIsBare('127', { status: 'error', message: 'x' })).toBe(false)
    expect(stationIsBare('L08', ready)).toBe(false)
    expect(stationIsBare('U01', ready)).toBe(false)
  })

  it('turns an interior await into a streets await once the index shows the station bare (a deep link)', () => {
    expect(classifyAwaiting(deepLink, ready)).toEqual({ ...deepLink, kind: 'streets' })
    expect(classifyAwaiting(deepLink, loading)).toBe(deepLink)
    const l08 = { ...deepLink, stationId: 'L08' }
    expect(classifyAwaiting(l08, ready)).toBe(l08)
    expect(classifyAwaiting(null, ready)).toBeNull()
  })

  it('then reframes once its streets load, and drops the await if it has no street file', () => {
    const a = classifyAwaiting(deepLink, ready)
    const at127 = { ...landed, focusedId: '127' }
    expect(reframeAction(a, { ...at127, ready: streetsReadyFor(a, undefined), missing: streetsMissingFor(a, undefined) })).toBe('wait')
    expect(reframeAction(a, { ...at127, ready: streetsReadyFor(a, { stationId: '127' }), missing: false })).toBe('reframe')
    expect(reframeAction(a, { ...at127, ready: false, missing: streetsMissingFor(a, null) })).toBe('drop')
  })

  it('never calls an interior await missing', () => {
    expect(streetsMissingFor(deepLink, null)).toBe(false)
    expect(streetsMissingFor(null, null)).toBe(false)
  })
})

describe('awaiting the priority frame with the trip panel open', () => {
  const union = { stationId: '635', memberStationIds: ['635', 'L03', 'R20'] }
  const frame = { stationId: 'L03', kind: 'frame' as const, reduced: false }

  it('follows an interior that is framed while the trip panel is open, and nothing else', () => {
    expect(nextAwaiting(awaiting, true)).toEqual({ ...awaiting, kind: 'frame' })
    expect(nextAwaiting(frame, true)).toBe(frame)
    // Trip panel closed: the landing is final, so a later outage poll or panel resize never moves the camera.
    expect(nextAwaiting(awaiting, false)).toBeNull()
    expect(nextAwaiting(frame, false)).toBeNull()
    expect(nextAwaiting({ stationId: 'L08', kind: 'streets', reduced: false }, true)).toBeNull()
    expect(nextAwaiting(null, true)).toBeNull()
  })

  it("is ready once the frame is the loaded interior's and the interior covers the awaited member", () => {
    expect(frameReadyFor(frame, { interiorId: '635' }, union)).toBe(true)
    expect(frameReadyFor(frame, null, union)).toBe(false)
    expect(frameReadyFor(frame, { interiorId: 'L08' }, union)).toBe(false)
    expect(frameReadyFor(frame, { interiorId: '635' }, null)).toBe(false)
    expect(frameReadyFor({ ...frame, stationId: 'L08' }, { interiorId: '635' }, union)).toBe(false)
    expect(frameReadyFor({ ...frame, kind: 'interior' }, { interiorId: '635' }, union)).toBe(false)
  })

  it('drops on a focus change, a follow or the trip panel closing (missing), and waits while there is no frame', () => {
    const ready = { ...landed, focusedId: 'L03' }
    expect(reframeAction(frame, ready)).toBe('reframe')
    expect(reframeAction(frame, { ...ready, ready: false })).toBe('wait')
    expect(reframeAction(frame, { ...ready, focusedId: '635' })).toBe('drop')
    expect(reframeAction(frame, { ...ready, following: true })).toBe('drop')
    expect(reframeAction(frame, { ...ready, missing: true })).toBe('drop')
  })
})
