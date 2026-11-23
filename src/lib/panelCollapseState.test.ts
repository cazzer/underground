import { describe, expect, it } from 'vitest'
import { collapseReducer, collapsedFront, frontPanel, INITIAL_COLLAPSE, type FrontPanel } from './panelCollapseState'

const FRONTS: FrontPanel[] = ['station', 'trip', 'changes', 'train', 'notice', null]
const none = { trainShown: false, noticeShown: false, changesOpen: false, tripOpen: false, focusedId: null }

describe('frontPanel', () => {
  it('ranks train over notice over changes over trip over station', () => {
    expect(frontPanel({ trainShown: true, noticeShown: true, changesOpen: true, tripOpen: true, focusedId: 'L08' })).toBe('train')
    expect(frontPanel({ ...none, noticeShown: true, changesOpen: true, tripOpen: true, focusedId: 'L08' })).toBe('notice')
    expect(frontPanel({ ...none, changesOpen: true, tripOpen: true, focusedId: 'L08' })).toBe('changes')
    expect(frontPanel({ ...none, tripOpen: true, focusedId: 'L08' })).toBe('trip')
    expect(frontPanel({ ...none, focusedId: 'L08' })).toBe('station')
  })
  it('puts the changes list in front with nothing else open', () => {
    expect(frontPanel({ ...none, changesOpen: true })).toBe('changes')
  })
  it('is null with no panel', () => {
    expect(frontPanel(none)).toBeNull()
  })
})

describe('collapseReducer', () => {
  it('starts expanded at seq 0 for every front', () => {
    expect(INITIAL_COLLAPSE.seq).toBe(0)
    for (const front of FRONTS) expect(collapsedFront(INITIAL_COLLAPSE, front)).toBe(false)
  })

  it('collapses the station panel in front and counts it', () => {
    const s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    expect(s.seq).toBe(1)
    expect(collapsedFront(s, 'station')).toBe(true)
    for (const front of ['trip', 'train', 'notice', null] as const) expect(collapsedFront(s, front)).toBe(false)
  })

  it('returns the same state for a repeat of the same value', () => {
    const s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    expect(collapseReducer(s, { type: 'set', panel: 'station', collapsed: true, front: 'station' })).toBe(s)
    expect(collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'trip', collapsed: false, front: 'trip' })).toBe(INITIAL_COLLAPSE)
  })

  it('ignores a toggle from a panel that is not in front', () => {
    for (const [panel, front] of [['station', 'trip'], ['trip', 'train'], ['station', null], ['trip', null]] as const) {
      expect(collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel, collapsed: true, front })).toBe(INITIAL_COLLAPSE)
    }
  })

  it('counts every collapse and expand', () => {
    let s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'trip', collapsed: true, front: 'trip' })
    s = collapseReducer(s, { type: 'set', panel: 'trip', collapsed: false, front: 'trip' })
    expect(s.seq).toBe(2)
    s = collapseReducer(s, { type: 'set', panel: 'trip', collapsed: true, front: 'trip' })
    expect(s.seq).toBe(3)
  })

  it('clears the trip flag on close without counting, and leaves the station flag', () => {
    let s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    s = collapseReducer(s, { type: 'set', panel: 'trip', collapsed: true, front: 'trip' })
    const closed = collapseReducer(s, { type: 'tripClosed' })
    expect(closed).toEqual({ ...INITIAL_COLLAPSE, station: true, trip: false, seq: 2 })
    expect(collapseReducer(closed, { type: 'tripClosed' })).toBe(closed)
  })

  it('expands a collapsed trip panel on a directions pick without counting, and leaves the station flag', () => {
    let s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    s = collapseReducer(s, { type: 'set', panel: 'trip', collapsed: true, front: 'trip' })
    const requested = collapseReducer(s, { type: 'tripRequested' })
    expect(requested).toEqual({ ...INITIAL_COLLAPSE, station: true, trip: false, seq: 2 })
    expect(collapseReducer(requested, { type: 'tripRequested' })).toBe(requested)
  })

  it('expands a collapsed station panel on an explicit pick without counting', () => {
    const s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    const picked = collapseReducer(s, { type: 'picked' })
    expect(picked).toEqual({ ...INITIAL_COLLAPSE, station: false, trip: false, seq: 1 })
    expect(collapseReducer(picked, { type: 'picked' })).toBe(picked)
  })

  it('leaves the trip flag alone on a pick', () => {
    const s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'trip', collapsed: true, front: 'trip' })
    expect(collapseReducer(s, { type: 'picked' })).toBe(s)
  })

  it('keeps the station flag across front changes without moving seq', () => {
    const s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    expect(collapsedFront(s, null)).toBe(false)
    expect(collapsedFront(s, 'station')).toBe(true)
    expect(s.seq).toBe(1)
  })
})

describe('the service changes panel', () => {
  const opened = collapseReducer(INITIAL_COLLAPSE, { type: 'changesOpened' })

  it('opens expanded without counting, and a repeat changes nothing', () => {
    expect(opened).toEqual({ ...INITIAL_COLLAPSE, changesOpen: true })
    expect(collapseReducer(opened, { type: 'changesOpened' })).toBe(opened)
  })

  it('collapses and expands only while in front, counting each', () => {
    expect(collapseReducer(opened, { type: 'set', panel: 'changes', collapsed: true, front: 'train' })).toBe(opened)
    expect(collapseReducer(opened, { type: 'set', panel: 'changes', collapsed: true, front: 'trip' })).toBe(opened)
    const collapsed = collapseReducer(opened, { type: 'set', panel: 'changes', collapsed: true, front: 'changes' })
    expect(collapsed.seq).toBe(1)
    expect(collapsedFront(collapsed, 'changes')).toBe(true)
    for (const front of ['station', 'trip', 'train', 'notice', null] as const) expect(collapsedFront(collapsed, front)).toBe(false)
    expect(collapseReducer(collapsed, { type: 'set', panel: 'changes', collapsed: false, front: 'changes' }).seq).toBe(2)
  })

  it('reopens expanded, and closing resets the collapse, neither moving seq', () => {
    const collapsed = collapseReducer(opened, { type: 'set', panel: 'changes', collapsed: true, front: 'changes' })
    expect(collapseReducer(collapsed, { type: 'changesOpened' })).toEqual({ ...opened, seq: 1 })
    const closed = collapseReducer(collapsed, { type: 'changesClosed' })
    expect(closed).toEqual({ ...INITIAL_COLLAPSE, seq: 1 })
    expect(collapseReducer(closed, { type: 'changesClosed' })).toBe(closed)
  })

  it('leaves the station and trip flags alone', () => {
    let s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    s = collapseReducer(s, { type: 'set', panel: 'trip', collapsed: true, front: 'trip' })
    const there = collapseReducer(collapseReducer(s, { type: 'changesOpened' }), { type: 'changesClosed' })
    expect(there).toEqual(s)
  })

  it('picks a change (each pick counted), clears it on a second press, replaces it with another row, never moving seq', () => {
    const picked = collapseReducer(opened, { type: 'changePicked', alertId: 'a' })
    expect(picked.changePick).toEqual({ alertId: 'a', seq: 1 })
    expect(picked.seq).toBe(0)
    const other = collapseReducer(picked, { type: 'changePicked', alertId: 'b' })
    expect(other.changePick).toEqual({ alertId: 'b', seq: 2 })
    const cleared = collapseReducer(other, { type: 'changePicked', alertId: 'b' })
    expect(cleared.changePick).toBeNull()
    expect(collapseReducer(cleared, { type: 'changePicked', alertId: 'b' }).changePick).toEqual({ alertId: 'b', seq: 3 })
    expect(cleared.seq).toBe(0)
  })

  it('keeps the pick through a collapse; Esc clears it alone; closing the list clears it', () => {
    const picked = collapseReducer(opened, { type: 'changePicked', alertId: 'a' })
    const collapsed = collapseReducer(picked, { type: 'set', panel: 'changes', collapsed: true, front: 'changes' })
    expect(collapsed.changePick).toEqual({ alertId: 'a', seq: 1 })
    expect(collapsed.seq).toBe(1)
    const escaped = collapseReducer(picked, { type: 'changePickCleared' })
    expect(escaped).toEqual({ ...picked, changePick: null })
    expect(collapseReducer(escaped, { type: 'changePickCleared' })).toBe(escaped)
    const closed = collapseReducer(collapsed, { type: 'changesClosed' })
    expect(closed.changePick).toBeNull()
    expect(closed.changesOpen).toBe(false)
    expect(closed.seq).toBe(1)
  })
})
