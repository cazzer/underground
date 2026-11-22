import { describe, expect, it } from 'vitest'
import { ENTER_DISTANCE, ENTER_RADIUS, EXIT_DISTANCE, EXIT_RADIUS, focusGroupOf, NO_FOCUS_GROUP, nextFocus, type FocusState } from './focusMachine'
import type { IndexLoad } from '../data/interiorLoad'
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
  dismissedGroup: ReadonlySet<string> = NO_FOCUS_GROUP,
) {
  const input = { ...state, distance, target: { x, z }, stations, settled, focusGroup, dismissedGroup }
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

describe('nextFocus after closing a complex member', () => {
  // Three members, the way Union Sq has them: the closed R20 and its siblings 635 and L03 around the hull centre.
  const R20 = station('R20', 0, 0)
  const S635 = station('635', 130, 0)
  const L03 = station('L03', 300, 0)
  const X = station('X', 0, 900)
  const members = [R20, S635, L03, X]
  const group = new Set(['R20', '635', 'L03'])
  const closed = dismissed('R20')
  const hull = 130

  it('does not reopen the panel as a sibling when the view is centered on the hull', () => {
    const { input, next } = run(closed, 400, hull, 0, members, true, NO_FOCUS_GROUP, group)
    expect(next).toBe(input)
    // Without the group, the sibling the view sits on takes the focus.
    expect(run(closed, 400, hull, 0, members).next).toEqual({ focusedId: '635', dismissedId: 'R20' })
  })

  it('keeps the dismissal while the view is within the exit radius of any member, however far from the closed one', () => {
    // 400 m from R20 (past EXIT_RADIUS), 100 m from L03.
    const { input, next } = run(closed, 400, 400, 0, members, true, NO_FOCUS_GROUP, group)
    expect(next).toBe(input)
    expect(run(closed, 400, 400, 0, members).next).toEqual(focused('L03'))
  })

  it('clears the dismissal once the view leaves every member, then focuses again on return', () => {
    const away = run(closed, 400, 0, EXIT_RADIUS + 100, members, true, NO_FOCUS_GROUP, group)
    expect(away.next).toEqual(NONE)
    expect(run(NONE, 400, hull, 0, members, true).next).toEqual(focused('635'))
  })

  it('still focuses a station outside the closed complex', () => {
    expect(run(closed, 400, 0, 900, members, true, NO_FOCUS_GROUP, group).next).toEqual(focused('X'))
  })

  it('ignores a group that does not hold the dismissed station', () => {
    expect(run(dismissed('X'), 400, hull, 0, members, true, NO_FOCUS_GROUP, group).next).toEqual(focused('635'))
  })
})

describe('focusGroupOf', () => {
  const index: IndexLoad = {
    status: 'ready',
    index: {
      stations: {
        L08: { provenance: 'authored' },
        T01: { provenance: 'authored' },
        U01: { provenance: 'authored', file: 'T01' },
        V01: { provenance: 'authored', file: 'T01' },
      },
    },
  }

  it('is the complex from the index, from any member, with no interior loaded (as after the panel closes)', () => {
    expect(focusGroupOf('U01', index, null)).toEqual(new Set(['T01', 'U01', 'V01']))
    expect(focusGroupOf('T01', index, null)).toEqual(new Set(['T01', 'U01', 'V01']))
  })

  it('is cut to the members the loaded interior covers', () => {
    expect(focusGroupOf('T01', index, { stationId: 'T01', memberStationIds: ['T01', 'U01'] })).toEqual(new Set(['T01', 'U01']))
    // An interior that covers only the station itself leaves no complex.
    expect(focusGroupOf('T01', index, { stationId: 'T01', memberStationIds: ['T01'] })).toBe(NO_FOCUS_GROUP)
  })

  it('is the shared empty group for a lone or unlisted station, no station, or an index that is not ready', () => {
    expect(focusGroupOf('L08', index, null)).toBe(NO_FOCUS_GROUP)
    expect(focusGroupOf('X99', index, null)).toBe(NO_FOCUS_GROUP)
    expect(focusGroupOf(null, index, null)).toBe(NO_FOCUS_GROUP)
    expect(focusGroupOf('T01', { status: 'loading' }, null)).toBe(NO_FOCUS_GROUP)
  })
})
