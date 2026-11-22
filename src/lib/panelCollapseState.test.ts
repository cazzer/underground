import { describe, expect, it } from 'vitest'
import { collapseReducer, collapsedFront, frontPanel, INITIAL_COLLAPSE, type FrontPanel } from './panelCollapseState'

const FRONTS: FrontPanel[] = ['station', 'trip', 'train', 'notice', null]
const none = { trainShown: false, noticeShown: false, tripOpen: false, focusedId: null }

describe('frontPanel', () => {
  it('ranks train over notice over trip over station', () => {
    expect(frontPanel({ trainShown: true, noticeShown: true, tripOpen: true, focusedId: 'L08' })).toBe('train')
    expect(frontPanel({ ...none, noticeShown: true, tripOpen: true, focusedId: 'L08' })).toBe('notice')
    expect(frontPanel({ ...none, tripOpen: true, focusedId: 'L08' })).toBe('trip')
    expect(frontPanel({ ...none, focusedId: 'L08' })).toBe('station')
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
    expect(closed).toEqual({ station: true, trip: false, seq: 2 })
    expect(collapseReducer(closed, { type: 'tripClosed' })).toBe(closed)
  })

  it('keeps the station flag across front changes without moving seq', () => {
    const s = collapseReducer(INITIAL_COLLAPSE, { type: 'set', panel: 'station', collapsed: true, front: 'station' })
    expect(collapsedFront(s, null)).toBe(false)
    expect(collapsedFront(s, 'station')).toBe(true)
    expect(s.seq).toBe(1)
  })
})
