import { describe, expect, it } from 'vitest'
import { initialTrainSelection, trainSelectionReducer, type TrainSelectionEvent, type TrainSelectionState } from './trainSelection'

interface Trip {
  key: string
  n?: number
}
type State = TrainSelectionState<Trip, string>
type Event = TrainSelectionEvent<Trip, string>

const summarize = (t: Trip): string => `${t.key}${t.n ?? ''}`
const run = (events: Event[], from: State = initialTrainSelection<Trip, string>()): State =>
  events.reduce(trainSelectionReducer<Trip, string>, from)
const poll = (...keys: string[]): Event => ({ type: 'observe', trips: keys.map((key) => ({ key })), summarize })
const select = (key: string): Event => ({ type: 'select', key, summarize })

describe('trainSelectionReducer', () => {
  it('selects a trip from the latest poll and keeps it across polls', () => {
    const s = run([poll('a', 'b'), select('b'), poll('b'), poll('a', 'b')])
    expect(s.key).toBe('b')
    expect(s.lastTrip).toEqual({ key: 'b' })
    expect(s.lastSummary).toBe('b')
    expect(s.missed).toBe(0)
    expect(s.selections).toBe(1)
  })

  it('keeps the selection, the last trip and its summary through one missed poll', () => {
    const first: Event = { type: 'observe', trips: [{ key: 'b', n: 1 }], summarize }
    const s = run([first, select('b'), poll('a')])
    expect(s.key).toBe('b')
    expect(s.missed).toBe(1)
    expect(s.lastTrip).toEqual({ key: 'b', n: 1 })
    expect(s.lastSummary).toBe('b1')
    expect(s.notice).toBeNull()
  })

  it('clears after two missed polls in a row, with a notice carrying the summary from when it was seen', () => {
    const first: Event = { type: 'observe', trips: [{ key: 'b', n: 7 }], summarize }
    const s = run([first, select('b'), poll('a'), poll('a')])
    expect(s.key).toBeNull()
    expect(s.notice).toEqual({ summary: 'b7' })
  })

  it('resets the miss count when the trip comes back', () => {
    const s = run([poll('b'), select('b'), poll(), poll('b'), poll()])
    expect(s.key).toBe('b')
    expect(s.missed).toBe(1)
  })

  it('counts the same trips array once', () => {
    const missing = poll('a')
    const s = run([poll('b'), select('b'), missing, missing])
    expect(s.key).toBe('b')
    expect(s.missed).toBe(1)
  })

  const outage: Event = { type: 'observe', trips: null, summarize }

  it('keeps the selection and its last trip while the live layer is gone', () => {
    const s = run([poll('b'), select('b'), outage])
    expect(s.key).toBe('b')
    expect(s.lastTrip).toEqual({ key: 'b' })
    expect(s.lastSummary).toBe('b')
    expect(s.notice).toBeNull()
    expect(s.missed).toBe(0)
  })

  it('pauses the miss count during an outage: neither added to nor reset', () => {
    const s = run([poll('b'), select('b'), poll('a'), outage])
    expect(s.key).toBe('b')
    expect(s.missed).toBe(1)
    // The next fresh poll without the trip is its second miss.
    const cleared = run([poll('a')], s)
    expect(cleared.key).toBeNull()
    expect(cleared.notice).toEqual({ summary: 'b' })
    // A fresh poll with it resets the count as usual.
    const back = run([poll('b'), poll('a')], s)
    expect(back.key).toBe('b')
    expect(back.lastTrip).toEqual({ key: 'b' })
    expect(back.missed).toBe(1)
  })

  it('still clears a truly gone trip when the layer flips between present and gone', () => {
    const s = run([poll('b'), select('b'), outage, poll('a'), outage, poll('a'), outage, poll('a')])
    expect(s.key).toBeNull()
    expect(s.notice).toEqual({ summary: 'b' })
  })

  it('reports an unknown trip with no summary', () => {
    const s = run([poll('a'), select('zz'), poll('a'), poll('a')])
    expect(s.notice).toEqual({ summary: null })
  })

  it('clears silently on a user clear, and a new select drops the notice', () => {
    const cleared = run([poll('b'), select('b'), { type: 'clear' }, poll(), poll()])
    expect(cleared.key).toBeNull()
    expect(cleared.notice).toBeNull()
    const lostThenNew = run([poll('b'), select('b'), poll(), poll(), select('c')])
    expect(lostThenNew.notice).toBeNull()
    expect(lostThenNew.selections).toBe(2)
    expect(run([{ type: 'dismissNotice' }], lostThenNew)).toBe(lostThenNew)
  })

  describe('following', () => {
    const unfollow: Event = { type: 'unfollow' }
    const follow: Event = { type: 'follow' }

    it('follows on every select', () => {
      expect(run([poll('b'), select('b')]).following).toBe(true)
    })

    it('stops following on unfollow and keeps the train', () => {
      const s = run([poll('b'), select('b'), unfollow])
      expect(s.following).toBe(false)
      expect(s.key).toBe('b')
      expect(run([unfollow], s)).toBe(s)
    })

    it('follows again on follow, which is a no-op without a train', () => {
      expect(run([poll('b'), select('b'), unfollow, follow]).following).toBe(true)
      const none = run([poll('b')])
      expect(run([follow], none)).toBe(none)
    })

    it('stops on a clear and when the train is lost', () => {
      expect(run([poll('b'), select('b'), { type: 'clear' }]).following).toBe(false)
      expect(run([poll('b'), select('b'), poll(), poll()]).following).toBe(false)
    })

    it('follows again on a re-select', () => {
      const s = run([poll('b'), select('b'), unfollow, select('b')])
      expect(s.following).toBe(true)
      expect(s.selections).toBe(2)
    })
  })
})
