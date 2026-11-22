import { describe, expect, it } from 'vitest'
import { ENTER_DISTANCE, ENTER_RADIUS, EXIT_DISTANCE, EXIT_RADIUS, focusGroupFor, NO_FOCUS_GROUP, nextFocus, type FocusState } from './focusMachine'
import type { Station } from './network'

const station = (id: string, x: number, z: number): Station => ({ id, name: id, pos: { x, z }, routeIds: [], stops: [], access: { status: 'none' } })
const A = station('A', 0, 0)
const B = station('B', 1000, 0)
const C = station('C', 0, EXIT_RADIUS + 150)
const E = station('E', 250, 0)

const NONE: FocusState = { focusedId: null, dismissedId: null }
const focused = (id: string): FocusState => ({ focusedId: id, dismissedId: null })
const dismissed = (id: string): FocusState => ({ focusedId: null, dismissedId: id })

function run(
  state: FocusState,
  distance: number,
  x: number,
  z: number,
  stations: readonly Station[] = [A],
  settled = true,
  focusGroup: ReadonlySet<string> = NO_FOCUS_GROUP,
) {
  const input = { ...state, distance, target: { x, z }, stations, settled, focusGroup }
  return { input, next: nextFocus(input) }
}

describe('nextFocus', () => {
  it('focuses a station when close and zoomed in', () => {
    expect(run(NONE, 200, 50, 0).next).toEqual(focused('A'))
  })

  it('does not focus when too far zoomed out', () => {
    const { input, next } = run(NONE, ENTER_DISTANCE + 100, 0, 0)
    expect(next).toBe(input)
  })

  it('does not focus when the station is outside the enter radius', () => {
    const { input, next } = run(NONE, 200, ENTER_RADIUS + 60, 0)
    expect(next).toBe(input)
  })

  it('keeps focus inside the hysteresis band', () => {
    const { input, next } = run(focused('A'), (ENTER_DISTANCE + EXIT_DISTANCE) / 2, 0, 0)
    expect(next).toBe(input)
  })

  it('drops focus when zoomed out past the exit distance', () => {
    expect(run(focused('A'), EXIT_DISTANCE + 10, 0, 0).next).toEqual(NONE)
  })

  it('drops focus when panned past the exit radius', () => {
    expect(run(focused('A'), 200, EXIT_RADIUS + 10, 0).next).toEqual(NONE)
  })

  it('measures the exit radius from the focused station, not the nearest one', () => {
    expect(run(focused('A'), ENTER_DISTANCE + 100, 0, EXIT_RADIUS + 50, [A, C]).next).toEqual(NONE)
  })

  it('switches to another station', () => {
    expect(run(focused('A'), 200, 1000, 0, [A, B]).next).toEqual(focused('B'))
  })

  it('does not refocus a dismissed station while the camera stays near it', () => {
    const { input, next } = run(dismissed('A'), 170, 0, 0)
    expect(next).toBe(input)
  })

  it('releases the dismissal when zoomed out, then refocuses on return', () => {
    const released = run(dismissed('A'), EXIT_DISTANCE + 10, 0, 0).next
    expect(released).toEqual(NONE)
    expect(run(released, 200, 0, 0).next).toEqual(focused('A'))
  })

  it('releases the dismissal when panned past the exit radius', () => {
    expect(run(dismissed('A'), 200, EXIT_RADIUS + 10, 0).next).toEqual(NONE)
  })

  it('focuses a different station while another stays dismissed', () => {
    expect(run(dismissed('A'), 200, 250, 0, [A, E]).next).toEqual({ focusedId: 'E', dismissedId: 'A' })
  })

  it('does not hand focus to a neighbour while centered on the dismissed station', () => {
    const stations = [A, station('B', 250, 0)]
    const toB = run(dismissed('A'), 200, 130, 0, stations).next
    expect(toB).toEqual({ focusedId: 'B', dismissedId: 'A' })
    expect(run(toB, 200, 0, 0, stations).next).toEqual(dismissed('A'))
  })

  it('switches stations only once the focused one is past the enter radius', () => {
    const stations = [A, station('B', 200, 0)]
    for (const x of [100, 110]) {
      const { input, next } = run(focused('A'), 200, x, 0, stations)
      expect(next).toBe(input)
    }
    expect(run(focused('A'), 200, 150, 0, stations).next).toEqual(focused('B'))
  })

  it('engages inside ENTER_DISTANCE and holds until past EXIT_DISTANCE', () => {
    const outside = run(NONE, ENTER_DISTANCE + 1, 0, 0)
    expect(outside.next).toBe(outside.input)
    const entered = run(NONE, ENTER_DISTANCE - 1, 0, 0).next
    expect(entered).toEqual(focused('A'))
    const held = run(entered, EXIT_DISTANCE, 0, 0)
    expect(held.next).toBe(held.input)
    expect(run(entered, EXIT_DISTANCE + 1, 0, 0).next).toEqual(NONE)
  })

  it('waits for the view to settle before entering, but drops focus at once', () => {
    const moving = run(NONE, 200, 0, 0, [A], false)
    expect(moving.next).toBe(moving.input)
    expect(run(NONE, 200, 0, 0, [A], true).next).toEqual(focused('A'))
    expect(run(focused('A'), EXIT_DISTANCE + 10, 0, 0, [A], false).next).toEqual(NONE)
    expect(run(focused('A'), 200, EXIT_RADIUS + 10, 0, [A], false).next).toEqual(NONE)
  })

  it('keeps the focused station while moving, and switches only once settled', () => {
    const held = run(focused('A'), 200, 0, 0, [A], false)
    expect(held.next).toBe(held.input)
    const stations = [A, station('B', 200, 0)]
    const passing = run(focused('A'), 200, 150, 0, stations, false)
    expect(passing.next).toBe(passing.input)
    expect(run(focused('A'), 200, 150, 0, stations, true).next).toEqual(focused('B'))
  })

  it('does nothing without stations', () => {
    const { input, next } = run(NONE, 100, 0, 0, [])
    expect(next).toBe(input)
  })
})

describe('nextFocus in a station complex', () => {
  // Fulton-like: two members 300 m apart; the interior flight lands on the hull centre between them.
  const M1 = station('M1', 0, 0)
  const M2 = station('M2', 300, 0)
  const X = station('X', 0, 600)
  const group = new Set(['M1', 'M2'])
  const all = [M1, M2, X]

  it('keeps the focused member when the view sits on the hull centre or over a sibling', () => {
    const centre = run(focused('M1'), 400, 150, 0, all, true, group)
    expect(centre.next).toBe(centre.input)
    // 40 m from M2, 260 m from M1: without the group the nearer station takes the focus.
    const over = run(focused('M1'), 400, 260, 0, all, true, group)
    expect(over.next).toBe(over.input)
    expect(run(focused('M1'), 400, 260, 0, all).next).toEqual(focused('M2'))
  })

  it('does not drop a member when the view is past EXIT_RADIUS from it but near a sibling', () => {
    const far = 300 + ENTER_RADIUS - 40
    const { input, next } = run(focused('M1'), 400, far, 0, all, true, group)
    expect(next).toBe(input)
    expect(run(focused('M1'), 400, far, 0, [M1, M2]).next).toEqual(focused('M2'))
  })

  it('drops focus once the view is past EXIT_RADIUS from every member, or zoomed out', () => {
    expect(run(focused('M1'), 400, 150, 800, [M1, M2], true, group).next).toEqual(NONE)
    expect(run(focused('M1'), EXIT_DISTANCE + 10, 150, 0, all, true, group).next).toEqual(NONE)
  })

  it('still lets a station outside the group take the focus', () => {
    expect(run(focused('M1'), 400, 0, 600, all, true, group).next).toEqual(focused('X'))
    expect(run(focused('M1'), 400, 0, 600 - ENTER_RADIUS - 10, all, true, group).next).toEqual(NONE)
  })

  it('ignores a group that does not hold the focused station, and an empty group is the old rule', () => {
    expect(run(focused('X'), 400, 260, 0, all, true, group).next).toEqual(focused('M2'))
    expect(run(NONE, 200, 50, 0, [M1, M2], true, group).next).toEqual(focused('M1'))
  })
})

describe('focusGroupFor', () => {
  const complex = { stationId: 'M1', memberStationIds: ['M1', 'M2'] }

  it('is the members of the interior covering the focused station, from any member', () => {
    expect(focusGroupFor(complex, 'M2')).toEqual(new Set(['M1', 'M2']))
    expect(focusGroupFor(complex, 'M1')).toEqual(new Set(['M1', 'M2']))
  })

  it('is the shared empty group for a lone station, an uncovered station, or no interior', () => {
    expect(focusGroupFor({ stationId: 'L08' }, 'L08')).toBe(NO_FOCUS_GROUP)
    expect(focusGroupFor(complex, 'X')).toBe(NO_FOCUS_GROUP)
    expect(focusGroupFor(complex, null)).toBe(NO_FOCUS_GROUP)
    expect(focusGroupFor(null, 'M1')).toBe(NO_FOCUS_GROUP)
  })
})
