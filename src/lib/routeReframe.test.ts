import { describe, expect, it } from 'vitest'
import { collapseDueIn, COLLAPSE_MAX_WAIT_MS, COLLAPSE_QUIET_MS } from './collapseReframe'
import { RESIZE_WINDOW_MS } from './resizeReframe'
import { routeMoveArms, routePending, routeReframeAction, type RouteReframeInput } from './routeReframe'

const landed = { landedAt: 1000, width: 390, height: 844 }
const move = (over: Partial<Parameters<typeof routeMoveArms>[2]> = {}) => ({
  nowMs: 1500,
  flying: false,
  following: false,
  tookOver: false,
  width: 390,
  height: 844,
  before: 400,
  after: 330,
  ...over,
})

describe('routeMoveArms', () => {
  it("arms on a measured move of the free rect's bottom inside the window", () => {
    expect(routeMoveArms(landed, true, move())).toBe(true)
  })
  it('does not arm after the window, once used or closed, or when the bottom held', () => {
    expect(routeMoveArms(landed, true, move({ nowMs: 1000 + RESIZE_WINDOW_MS }))).toBe(false)
    expect(routeMoveArms(landed, false, move())).toBe(false)
    expect(routeMoveArms(landed, true, move({ after: 400.2 }))).toBe(false)
  })
  it('does not arm over a rotation, a gesture, a flight or a follow', () => {
    for (const over of [{ width: 844, height: 390 }, { tookOver: true }, { flying: true }, { following: true }]) {
      expect(routeMoveArms(landed, true, move(over))).toBe(false)
    }
  })
})

describe('routePending', () => {
  it('settles when the panel has been quiet, at most the cap after the toggle', () => {
    const p = routePending('toggle', 5000, false)
    expect(collapseDueIn(p, 5000)).toBe(COLLAPSE_QUIET_MS)
    expect(collapseDueIn({ ...p, panelAt: 5400 }, 5400)).toBe(COLLAPSE_QUIET_MS)
    expect(collapseDueIn({ ...p, panelAt: 5590 }, 5590)).toBe(COLLAPSE_MAX_WAIT_MS - 590)
  })
})

describe('routeReframeAction', () => {
  const ok: RouteReframeInput = { flying: false, following: false, tookOver: false, landed: true, front: true, reduced: false }
  it('reframes, or snaps under reduced motion', () => {
    expect(routeReframeAction(ok)).toBe('reframe')
    expect(routeReframeAction({ ...ok, reduced: true })).toBe('snap')
  })
  it.each([{ flying: true }, { following: true }, { tookOver: true }, { landed: false }, { front: false }])('drops for %j', (over) => {
    expect(routeReframeAction({ ...ok, ...over })).toBe('drop')
  })
})
