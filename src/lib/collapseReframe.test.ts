import { describe, expect, it } from 'vitest'
import { collapseAction, collapseDueIn, COLLAPSE_MAX_WAIT_MS, COLLAPSE_QUIET_MS, moveGains, panelMoveArms, reframeGains, type CollapsePending, type PanelMoveInput } from './collapseReframe'
import { interiorFreeRect } from './interiorCamera'

const pending = (over: Partial<CollapsePending> = {}): CollapsePending => ({ kind: 'toggle', stationId: '635', bumpedAt: 1000, panelAt: 1000, reduced: false, ...over })

describe('collapseDueIn', () => {
  it('waits for the panel to hold still', () => {
    expect(collapseDueIn(pending(), 1000)).toBe(COLLAPSE_QUIET_MS)
    expect(collapseDueIn(pending(), 1100)).toBe(COLLAPSE_QUIET_MS - 100)
    expect(collapseDueIn(pending(), 1000 + COLLAPSE_QUIET_MS)).toBe(0)
  })

  it('restarts the wait on each move of the panel', () => {
    expect(collapseDueIn(pending({ panelAt: 1120 }), 1200)).toBe(70)
  })

  it('never waits past the cap after the toggle, however the panel keeps moving', () => {
    const p = pending({ panelAt: 1000 + COLLAPSE_MAX_WAIT_MS - 10 })
    expect(collapseDueIn(p, 1000 + COLLAPSE_MAX_WAIT_MS - 10)).toBe(10)
    expect(collapseDueIn(p, 1000 + COLLAPSE_MAX_WAIT_MS)).toBe(0)
    expect(collapseDueIn(p, 5000)).toBe(0)
  })
})

describe('reframeGains', () => {
  it('stays put when the view already frames every point', () => {
    expect(reframeGains([7, 2], [7, 2], [7, 2])).toBe(false)
    expect(reframeGains([0, 10], [0, 10], [0, 10])).toBe(false)
  })

  it('moves when the new framing shows more of the path', () => {
    expect(reframeGains([3, 0], [7, 0], [7, 0])).toBe(true)
  })

  it('moves when it shows as much of the path and more machines', () => {
    expect(reframeGains([7, 1], [7, 2], [7, 2])).toBe(true)
  })

  it('moves on a tie: the landing for this layout', () => {
    expect(reframeGains([0, 0], [0, 0], [7, 0])).toBe(true)
  })

  it('stays put when the view shows more than the new framing would', () => {
    expect(reframeGains([5, 0], [3, 0], [7, 0])).toBe(false)
    expect(reframeGains([3, 2], [3, 1], [7, 2])).toBe(false)
    // More of the path beats more machines.
    expect(reframeGains([4, 0], [3, 2], [7, 2])).toBe(false)
  })
})

describe('collapseAction', () => {
  const idle = { flying: false, following: false, focusedId: '635', tookOver: false, lateArrival: false, bare: false }
  it('reframes, or snaps under reduced motion', () => {
    expect(collapseAction(pending(), idle)).toBe('reframe')
    expect(collapseAction(pending({ reduced: true }), idle)).toBe('snap')
  })

  it('drops on another flight, a follow or a focus change', () => {
    expect(collapseAction(pending(), { ...idle, flying: true })).toBe('drop')
    expect(collapseAction(pending(), { ...idle, following: true })).toBe('drop')
    expect(collapseAction(pending(), { ...idle, focusedId: 'L08' })).toBe('drop')
    expect(collapseAction(pending(), { ...idle, focusedId: null })).toBe('drop')
  })

  it('leaves a view the user panned or turned since the landing where it is', () => {
    expect(collapseAction(pending(), { ...idle, tookOver: true })).toBe('drop')
    expect(collapseAction(pending({ reduced: true }), { ...idle, tookOver: true })).toBe('drop')
  })

  it('leaves a late interior or streets to their own reframe, so the landing moves once', () => {
    expect(collapseAction(pending(), { ...idle, lateArrival: true })).toBe('drop')
  })
})

describe('a bare station panel that grows after landing (ost.18)', () => {
  const phone = { width: 390, height: 844 }
  const insets = { top: 60, bottom: 0 }
  const bottom = (top: number, left = 0) => interiorFreeRect(phone, insets, { left, top, right: 390, bottom: 844 }).bottom
  const landed: PanelMoveInput = {
    flying: false,
    following: false,
    tookOver: false,
    lateArrival: false,
    focusedId: '127',
    flownId: '127',
    bare: true,
    before: bottom(410),
    after: bottom(354),
    sameViewport: true,
  }

  it('arms when the panel grows after the landing', () => {
    expect(panelMoveArms(landed)).toBe(true)
  })

  it('arms on a shrink too: the reframe decides whether it gains', () => {
    expect(panelMoveArms({ ...landed, before: landed.after, after: landed.before })).toBe(true)
  })

  it('never arms after a gesture since the landing', () => {
    expect(panelMoveArms({ ...landed, tookOver: true })).toBe(false)
  })

  it('never arms for a station with an interior: panel size alone never moves it', () => {
    expect(panelMoveArms({ ...landed, bare: false })).toBe(false)
    const resize = pending({ kind: 'resize', stationId: 'L08' })
    const idle = { flying: false, following: false, focusedId: 'L08', tookOver: false, lateArrival: false, bare: false }
    expect(collapseAction(resize, idle)).toBe('drop')
    expect(collapseAction(resize, { ...idle, bare: true })).toBe('reframe')
    expect(collapseAction(pending({ kind: 'resize', stationId: 'L08', reduced: true }), { ...idle, bare: true })).toBe('snap')
  })

  it('never arms mid-flight, while following, or with a late streets reframe pending', () => {
    expect(panelMoveArms({ ...landed, flying: true })).toBe(false)
    expect(panelMoveArms({ ...landed, following: true })).toBe(false)
    expect(panelMoveArms({ ...landed, lateArrival: true })).toBe(false)
  })

  it('needs the landing to be this station’s own flight, with its panel in front since', () => {
    expect(panelMoveArms({ ...landed, flownId: null })).toBe(false)
    expect(panelMoveArms({ ...landed, flownId: '120' })).toBe(false)
    expect(panelMoveArms({ ...landed, focusedId: null })).toBe(false)
  })

  it('ignores a panel appearing or closing, a window resize, and a move that leaves the free area as it was', () => {
    expect(panelMoveArms({ ...landed, before: null })).toBe(false)
    expect(panelMoveArms({ ...landed, after: null })).toBe(false)
    expect(panelMoveArms({ ...landed, sameViewport: false })).toBe(false)
    expect(panelMoveArms({ ...landed, after: landed.before })).toBe(false)
  })

  it('never arms for a desktop side panel, whose growth leaves the free area’s bottom alone', () => {
    const desktop = { width: 1440, height: 900 }
    const side = (bottomPx: number) => interiorFreeRect(desktop, insets, { left: 1040, top: 80, right: 1424, bottom: bottomPx }).bottom
    expect(panelMoveArms({ ...landed, before: side(400), after: side(620) })).toBe(false)
  })

  it('moves only when the new framing shows strictly more: the station first, then marks', () => {
    expect(moveGains('resize', [1, 8], [1, 10], [1, 16])).toBe(true)
    expect(moveGains('resize', [0, 9], [1, 6], [1, 16])).toBe(true)
    expect(moveGains('resize', [1, 2], [1, 2], [1, 6])).toBe(false)
    expect(moveGains('resize', [1, 6], [1, 5], [1, 6])).toBe(false)
    expect(moveGains('resize', [1, 4], [0, 6], [1, 6])).toBe(false)
    // A toggle keeps its own rule: a tie takes the landing for the new layout.
    expect(moveGains('toggle', [1, 2], [1, 2], [1, 6])).toBe(true)
  })
})
