import { describe, expect, it } from 'vitest'
import { nextFocus, type FocusState } from './focusMachine'
import type { Station } from './network'

const station = (id: string, x: number, z: number): Station => ({ id, name: id, pos: { x, z }, routeIds: [], stops: [] })
const A = station('A', 0, 0)
const B = station('B', 1000, 0)
const C = station('C', 0, 450)
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
) {
  const input = { ...state, distance, target: { x, z }, stations }
  return { input, next: nextFocus(input) }
}

describe('nextFocus', () => {
  it('focuses a station when close and zoomed in', () => {
    expect(run(NONE, 200, 50, 0).next).toEqual(focused('A'))
  })

  it('does not focus when too far zoomed out', () => {
    const { input, next } = run(NONE, 300, 0, 0)
    expect(next).toBe(input)
  })

  it('does not focus when the station is outside the enter radius', () => {
    const { input, next } = run(NONE, 200, 200, 0)
    expect(next).toBe(input)
  })

  it('keeps focus inside the hysteresis band', () => {
    const { input, next } = run(focused('A'), 400, 0, 0)
    expect(next).toBe(input)
  })

  it('drops focus when zoomed out past the exit distance', () => {
    expect(run(focused('A'), 430, 0, 0).next).toEqual(NONE)
  })

  it('drops focus when panned past the exit radius', () => {
    expect(run(focused('A'), 200, 310, 0).next).toEqual(NONE)
  })

  it('measures the exit radius from the focused station, not the nearest one', () => {
    expect(run(focused('A'), 300, 0, 400, [A, C]).next).toEqual(NONE)
  })

  it('switches to another station', () => {
    expect(run(focused('A'), 200, 1000, 0, [A, B]).next).toEqual(focused('B'))
  })

  it('does not refocus a dismissed station while the camera stays near it', () => {
    const { input, next } = run(dismissed('A'), 170, 0, 0)
    expect(next).toBe(input)
  })

  it('releases the dismissal when zoomed out, then refocuses on return', () => {
    const released = run(dismissed('A'), 430, 0, 0).next
    expect(released).toEqual(NONE)
    expect(run(released, 200, 0, 0).next).toEqual(focused('A'))
  })

  it('releases the dismissal when panned past the exit radius', () => {
    expect(run(dismissed('A'), 200, 310, 0).next).toEqual(NONE)
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

  it('does nothing without stations', () => {
    const { input, next } = run(NONE, 100, 0, 0, [])
    expect(next).toBe(input)
  })
})
