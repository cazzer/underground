import { describe, expect, it } from 'vitest'
import { shouldReleaseHold, type FocusHold } from './focusHold'
import { EXIT_DISTANCE } from './focusMachine'

const HOLD: FocusHold = { stationId: 'L08', distance: 2000, target: { x: 100, z: 100 } }

describe('shouldReleaseHold', () => {
  it('holds while parked at the cancel point', () => {
    expect(shouldReleaseHold(HOLD, 2000, { x: 100, z: 100 })).toBe(false)
  })

  it('releases at or inside the exit distance', () => {
    expect(shouldReleaseHold(HOLD, EXIT_DISTANCE, { x: 100, z: 100 })).toBe(true)
    expect(shouldReleaseHold(HOLD, 200, { x: 100, z: 100 })).toBe(true)
  })

  it('releases on a deliberate zoom out', () => {
    expect(shouldReleaseHold(HOLD, 2000 * 1.25, { x: 100, z: 100 })).toBe(false)
    expect(shouldReleaseHold(HOLD, 2000 * 1.26, { x: 100, z: 100 })).toBe(true)
  })

  it('releases on a large pan', () => {
    expect(shouldReleaseHold(HOLD, 2000, { x: 100 + 601, z: 100 })).toBe(true)
  })

  it('holds through a small pan or a slight zoom in', () => {
    expect(shouldReleaseHold(HOLD, 2000, { x: 300, z: 300 })).toBe(false)
    expect(shouldReleaseHold(HOLD, 1500, { x: 100, z: 100 })).toBe(false)
  })
})
