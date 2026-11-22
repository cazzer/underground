import { describe, expect, it } from 'vitest'
import { groupPositions, shouldReleaseHold, type FocusHold } from './focusHold'
import { EXIT_DISTANCE, EXIT_RADIUS } from './focusMachine'

// Cancelled beyond EXIT_DISTANCE (1450 m), where a hold matters: inside it the focus rules take over anyway.
const HOLD: FocusHold = { stationId: 'L08', station: { x: 100, z: 100 }, distance: 3000, target: { x: 100, z: 100 } }

describe('shouldReleaseHold', () => {
  it('holds while parked at the cancel point', () => {
    expect(shouldReleaseHold(HOLD, 3000, { x: 100, z: 100 })).toBe(false)
  })

  it('releases at or inside the exit distance near the station', () => {
    expect(shouldReleaseHold(HOLD, EXIT_DISTANCE, { x: 100, z: 100 })).toBe(true)
    expect(shouldReleaseHold(HOLD, 200, { x: 100 + EXIT_RADIUS, z: 100 })).toBe(true)
  })

  it('keeps holding inside the exit distance while the view is past the exit radius', () => {
    // A flight cut short mid-pan: close enough in, but the focus rules would drop the station there.
    const midPan: FocusHold = { ...HOLD, distance: 1000, target: { x: 600, z: 100 } }
    expect(shouldReleaseHold(midPan, 1000, { x: 600, z: 100 })).toBe(false)
    expect(shouldReleaseHold(midPan, 900, { x: 600, z: 100 })).toBe(false)
  })

  it('releases on a deliberate zoom out', () => {
    expect(shouldReleaseHold(HOLD, 3000 * 1.25, { x: 100, z: 100 })).toBe(false)
    expect(shouldReleaseHold(HOLD, 3000 * 1.26, { x: 100, z: 100 })).toBe(true)
  })

  it('releases on a large pan', () => {
    expect(shouldReleaseHold(HOLD, 3000, { x: 100 + 901, z: 100 })).toBe(true)
  })

  it('holds through a small pan or a slight zoom in', () => {
    expect(shouldReleaseHold(HOLD, 3000, { x: 300, z: 300 })).toBe(false)
    expect(shouldReleaseHold(HOLD, EXIT_DISTANCE + 100, { x: 100, z: 100 })).toBe(false)
  })

  it('releases on a smaller pan once zoomed in after the interrupt', () => {
    // 600 m is under 0.3 x 3000 m but over 0.3 x 1500 m (still beyond EXIT_DISTANCE).
    expect(shouldReleaseHold(HOLD, 3000, { x: 700, z: 100 })).toBe(false)
    expect(shouldReleaseHold(HOLD, 1500, { x: 700, z: 100 })).toBe(true)
  })
})

describe('a hold on a complex member', () => {
  // A flight to a member lands on the hull centre; the hold measures from the nearest member.
  const midPan: FocusHold = { stationId: 'M1', station: { x: 0, z: 0 }, distance: 1000, target: { x: 600, z: 100 } }
  const members = [{ x: 0, z: 0 }, { x: 300, z: 0 }]

  it('releases where a sibling keeps the focus, which the held member alone would not', () => {
    expect(shouldReleaseHold(midPan, 1000, { x: 600, z: 100 })).toBe(false)
    expect(shouldReleaseHold({ ...midPan, members }, 1000, { x: 600, z: 100 })).toBe(true)
  })

  it('still keeps holding when the view is past the exit radius from every member', () => {
    expect(shouldReleaseHold({ ...midPan, members }, 1000, { x: 800, z: 100 })).toBe(false)
  })
})

describe('groupPositions', () => {
  const stations = new Map([['M1', { pos: { x: 0, z: 0 } }], ['M2', { pos: { x: 300, z: 0 } }]])

  it('lists the positions of the members, skipping an id the map lacks, and nothing for no group', () => {
    expect(groupPositions(new Set(['M1', 'M2', 'Z9']), stations)).toEqual([{ x: 0, z: 0 }, { x: 300, z: 0 }])
    expect(groupPositions(new Set(), stations)).toBeUndefined()
  })
})
