import { describe, expect, it } from 'vitest'
import type { TripJourney, TripLeg } from './route/plan'
import { droppedNote, focusAfterViewChange, journeyKey, journeyKeys, reconcileOpened, selectedFirst, tripSelection } from './tripSelection'

function ride(routeId: string, board: string, alight: string, tripId = `${routeId}-1`, live = false): TripLeg {
  return { kind: 'ride', routeId, tripId, patternKey: 'p', boardStop: board, alightStop: alight, terminalStop: 'XN', stops: [board, alight], departAt: 0, arriveAt: 60, live }
}
const walk: TripLeg = { kind: 'walk', fromStop: 'A1N', toStop: 'B1N', sameStation: false, startAt: 0, durationS: 60, endAt: 60 }
const journey = (...legs: TripLeg[]): TripJourney => ({ departAt: 0, arriveAt: 60, transfers: 0, legs })

describe('journeyKeys', () => {
  it('keys each journey by its routes and stops', () => {
    const keys = journeyKeys([journey(ride('L', 'A1N', 'B1N')), journey(ride('G', 'A1N', 'B1N'), walk)])
    expect(keys).toEqual(['L:A1N:B1N', 'G:A1N:B1N>walk:A1N:B1N'])
  })

  it('suffixes a journey with the same legs on another train', () => {
    const keys = journeyKeys([journey(ride('L', 'A1N', 'B1N', 'x')), journey(ride('L', 'A1N', 'B1N', 'y')), journey(ride('L', 'A1N', 'B1N', 'z'))])
    expect(keys).toEqual(['L:A1N:B1N', 'L:A1N:B1N#1', 'L:A1N:B1N#2'])
  })

  it('keeps the key when a scheduled train is swapped for its live twin', () => {
    expect(journeyKey(journey(ride('L', 'A1N', 'B1N', 'sched', false)))).toBe(journeyKey(journey(ride('L', 'A1N', 'B1N', 'rt:live', true))))
  })
})

describe('tripSelection', () => {
  const keys = ['a', 'b', 'c']
  it('shows nothing without journeys', () => {
    expect(tripSelection([], 'p', null)).toEqual({ view: 'none', openedKey: null, selectedIndex: -1, canGoBack: false })
  })

  it('lists the journeys and selects the first for the map when none is opened', () => {
    expect(tripSelection(keys, 'p', null)).toEqual({ view: 'list', openedKey: null, selectedIndex: 0, canGoBack: false })
  })

  it('shows the opened journey as a detail with Back', () => {
    expect(tripSelection(keys, 'p', { planKey: 'p', key: 'b' })).toEqual({ view: 'detail', openedKey: 'b', selectedIndex: 1, canGoBack: true })
  })

  it('lists when the opened journey left the plan or belongs to other ends', () => {
    expect(tripSelection(keys, 'p', { planKey: 'p', key: 'gone' }).view).toBe('list')
    expect(tripSelection(keys, 'p', { planKey: 'other', key: 'b' }).view).toBe('list')
  })

  it('opens a lone journey directly, with no Back, opened or not', () => {
    expect(tripSelection(['a'], 'p', null)).toEqual({ view: 'detail', openedKey: 'a', selectedIndex: 0, canGoBack: false })
    expect(tripSelection(['a'], 'p', { planKey: 'p', key: 'a' })).toEqual({ view: 'detail', openedKey: 'a', selectedIndex: 0, canGoBack: false })
  })

  it('has no Back when the opened journey is the only one left', () => {
    expect(tripSelection(['b'], 'p', { planKey: 'p', key: 'b' }).canGoBack).toBe(false)
  })
})

describe('reconcileOpened', () => {
  const open = { planKey: 'p', key: 'b' }
  it('keeps the opened journey, the same object, while it is offered', () => {
    const r = reconcileOpened(open, 'p', ['a', 'b', 'c'], 'poll')
    expect(r.opened).toBe(open)
    expect(r.dropped).toBe(false)
  })

  it('clears it and notes the drop when a poll or tick leaves several others', () => {
    expect(reconcileOpened(open, 'p', ['a', 'c', 'd'], 'poll')).toEqual({ opened: null, dropped: true })
    expect(reconcileOpened(open, 'p', ['a', 'c', 'd'], 'tick')).toEqual({ opened: null, dropped: true })
  })

  it('opens the one left and notes the drop', () => {
    expect(reconcileOpened(open, 'p', ['c'], 'poll')).toEqual({ opened: { planKey: 'p', key: 'c' }, dropped: true })
  })

  it('notes the drop with none left', () => {
    expect(reconcileOpened(open, 'p', [], 'tick')).toEqual({ opened: null, dropped: true })
  })

  it('does not note a drop on a retry or new ends: the plan announcement covers them', () => {
    expect(reconcileOpened(open, 'p', ['a', 'c'], 'retry')).toEqual({ opened: null, dropped: false })
    expect(reconcileOpened(open, 'p', ['a', 'c'], 'ends')).toEqual({ opened: null, dropped: false })
  })

  it('resets for other ends without a drop, and opens a lone journey there', () => {
    expect(reconcileOpened(open, 'q', ['b', 'c'], 'poll')).toEqual({ opened: null, dropped: false })
    expect(reconcileOpened(open, 'q', ['x'], 'poll')).toEqual({ opened: { planKey: 'q', key: 'x' }, dropped: false })
  })

  it('opens the only journey of a plan when none is opened, and leaves a list alone', () => {
    expect(reconcileOpened(null, 'p', ['a'], 'ends')).toEqual({ opened: { planKey: 'p', key: 'a' }, dropped: false })
    expect(reconcileOpened(null, 'p', ['a', 'b'], 'ends')).toEqual({ opened: null, dropped: false })
  })

  it('is idempotent', () => {
    const first = reconcileOpened(open, 'p', ['c'], 'poll')
    const again = reconcileOpened(first.opened, 'p', ['c'], 'poll')
    expect(again).toEqual({ opened: first.opened, dropped: false })
    expect(again.opened).toBe(first.opened)
  })
})

describe('droppedNote', () => {
  it('says how many trips are left', () => {
    expect(droppedNote(0)).toBe('That trip is no longer offered. No other trip found.')
    expect(droppedNote(1)).toBe('That trip is no longer offered. Showing the other trip.')
    expect(droppedNote(3)).toBe('That trip is no longer offered. Showing all 3 trips.')
  })
})

describe('focusAfterViewChange', () => {
  it('goes to the detail heading when the detail shows', () => {
    expect(focusAfterViewChange('detail', 'a', ['a', 'b'])).toEqual({ kind: 'detail' })
  })

  it('goes back to the row it left when the list shows it, else the panel heading', () => {
    expect(focusAfterViewChange('list', 'b', ['a', 'b'])).toEqual({ kind: 'row', key: 'b' })
    expect(focusAfterViewChange('list', 'gone', ['a', 'b'])).toEqual({ kind: 'panel' })
    expect(focusAfterViewChange('list', null, ['a', 'b'])).toEqual({ kind: 'panel' })
    expect(focusAfterViewChange('none', 'a', [])).toEqual({ kind: 'panel' })
  })
})

describe('selectedFirst', () => {
  it('moves the selected journey to the front and keeps the rest in order', () => {
    expect(selectedFirst(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b'])
    expect(selectedFirst(['a', 'b', 'c'], 'a')).toEqual(['a', 'b', 'c'])
  })

  it('leaves the order for null or a journey not in the list', () => {
    expect(selectedFirst(['a', 'b'], null)).toEqual(['a', 'b'])
    expect(selectedFirst(['a', 'b'], 'z')).toEqual(['a', 'b'])
  })
})
