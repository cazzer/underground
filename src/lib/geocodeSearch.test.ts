import { describe, expect, it } from 'vitest'
import { parseGeocodeRequest } from '../../worker/src/geocodeQuery'
import type { GeocodeResponse } from '../data/realtime'
import {
  answerKey,
  geocodeQueryText,
  geocodeStep,
  INITIAL_GEOCODE,
  rememberAnswer,
  type GeocodeEvent,
  type GeocodeMachine,
} from './geocodeSearch'

const response = (label: string, incomplete = false): GeocodeResponse => ({
  version: 2,
  results: [{ label, kind: 'address', lat: 40.7, lon: -74, source: 'geosearch' }],
  attribution: { geosearch: 'x' },
  incomplete,
})

/** Applies events in order, collecting every effect. */
function play(events: GeocodeEvent[], from: GeocodeMachine = INITIAL_GEOCODE) {
  let m = from
  const effects: unknown[] = []
  for (const e of events) {
    const step = geocodeStep(m, e)
    m = step.next
    effects.push(...step.effects)
  }
  return { m, effects }
}

describe('geocodeStep input', () => {
  it('sends nothing under 3 code points, after normalizing', () => {
    expect(play([{ type: 'input', text: '12' }])).toMatchObject({ m: { phase: 'idle', query: '' }, effects: [] })
    expect(play([{ type: 'input', text: '  12  ' }])).toMatchObject({ m: { phase: 'idle', query: '' }, effects: [] })
  })

  it('debounces: 120 schedules, a trailing space is a no-op', () => {
    const first = geocodeStep(INITIAL_GEOCODE, { type: 'input', text: '120' })
    expect(first.effects).toEqual([{ type: 'cancel' }, { type: 'schedule', seq: 1, delayMs: 250 }])
    expect(first.next).toMatchObject({ phase: 'debouncing', query: '120', seq: 1 })
    const again = geocodeStep(first.next, { type: 'input', text: '120 ' })
    expect(again.next).toBe(first.next)
    expect(again.effects).toEqual([])
  })

  it('only the last keystroke fires a fetch', () => {
    const { m } = play([
      { type: 'input', text: '120' },
      { type: 'input', text: '120 b' },
      { type: 'input', text: '120 br' },
    ])
    expect(m.seq).toBe(3)
    expect(geocodeStep(m, { type: 'fire', seq: 1, focus: null, cached: null }).effects).toEqual([])
    expect(geocodeStep(m, { type: 'fire', seq: 2, focus: null, cached: null }).effects).toEqual([])
    const focus = { lat: 40.73, lon: -73.99 }
    expect(geocodeStep(m, { type: 'fire', seq: 3, focus, cached: null }).effects).toEqual([{ type: 'fetch', seq: 3, query: '120 br', focus }])
  })

  it('aborts the request in flight on new input and ignores its late answer', () => {
    const { m } = play([
      { type: 'input', text: '120' },
      { type: 'fire', seq: 1, focus: null, cached: null },
      { type: 'answer', seq: 1, answer: { ok: true, response: response('A') } },
      { type: 'input', text: '120 b' },
      { type: 'fire', seq: 2, focus: null, cached: null },
    ])
    expect(m.phase).toBe('loading')
    const next = geocodeStep(m, { type: 'input', text: '120 bro' })
    expect(next.effects[0]).toEqual({ type: 'cancel' })
    const late = geocodeStep(next.next, { type: 'answer', seq: 2, answer: { ok: true, response: response('B') } })
    expect(late.next).toBe(next.next)
    expect(late.next.shown?.query).toBe('120')
  })

  it('keeps the last answer while the next loads, and drops it when the text is short again', () => {
    const { m } = play([
      { type: 'input', text: '120' },
      { type: 'fire', seq: 1, focus: null, cached: null },
      { type: 'answer', seq: 1, answer: { ok: true, response: response('A') } },
      { type: 'input', text: '120 b' },
    ])
    expect(m.shown?.query).toBe('120')
    const short = geocodeStep(m, { type: 'input', text: '12' })
    expect(short.effects).toEqual([{ type: 'cancel' }])
    expect(short.next).toMatchObject({ shown: null, phase: 'idle', query: '' })
  })

  it('counts an emoji as one code point and sends nothing over 100', () => {
    expect(geocodeQueryText('😀😀😀')).toBe('😀😀😀')
    expect(geocodeQueryText('😀😀')).toBeNull()
    expect(geocodeQueryText('a'.repeat(100))).not.toBeNull()
    expect(geocodeQueryText('a'.repeat(101))).toBeNull()
  })
})

describe('geocodeStep fire and answer', () => {
  it('settles from the cache with no fetch', () => {
    const { m, effects } = play([
      { type: 'input', text: '120' },
      { type: 'fire', seq: 1, focus: null, cached: response('C') },
    ])
    expect(m).toMatchObject({ phase: 'settled', shown: { query: '120' } })
    expect(effects).toEqual([{ type: 'cancel' }, { type: 'schedule', seq: 1, delayMs: 250 }])
  })

  it('a failure settles with no rows, and a new input clears it', () => {
    const { m } = play([
      { type: 'input', text: '120' },
      { type: 'fire', seq: 1, focus: null, cached: null },
      { type: 'answer', seq: 1, answer: { ok: false, error: 'busy', status: 503 } },
    ])
    expect(m).toMatchObject({ phase: 'settled', error: 'busy', shown: null })
    expect(geocodeStep(m, { type: 'input', text: '120 b' }).next).toMatchObject({ phase: 'debouncing', error: null })
  })

  it('an answer outside loading is ignored', () => {
    const { m } = play([{ type: 'input', text: '120' }])
    expect(geocodeStep(m, { type: 'answer', seq: 1, answer: { ok: true, response: response('A') } }).next).toBe(m)
  })

  it('reset cancels, and a late fire or answer of the old seq lands nowhere', () => {
    const { m } = play([
      { type: 'input', text: '120' },
      { type: 'fire', seq: 1, focus: null, cached: null },
    ])
    const reset = geocodeStep(m, { type: 'reset' })
    expect(reset.effects).toEqual([{ type: 'cancel' }])
    expect(reset.next).toMatchObject({ phase: 'idle', shown: null, query: '' })
    expect(geocodeStep(reset.next, { type: 'answer', seq: 1, answer: { ok: true, response: response('A') } }).next).toBe(reset.next)
    expect(geocodeStep(reset.next, { type: 'fire', seq: 1, focus: null, cached: null }).effects).toEqual([])
    expect(geocodeStep(reset.next, { type: 'reset' }).effects).toEqual([])
  })
})

describe('geocodeQueryText', () => {
  it('agrees with the Worker about what is a sendable query', () => {
    const texts = ['', 'ab', 'abc', '  a b ', 'a  b', '120 Broadway', 'Katz’s deli', 'a'.repeat(100), 'a'.repeat(101), '​​abc', '​ab', '😀😀😀', '😀😀', '１２０']
    for (const text of texts) {
      const worker = parseGeocodeRequest(new URL(`http://w/geocode?q=${encodeURIComponent(text)}`))
      expect([text, geocodeQueryText(text) !== null]).toEqual([text, worker.ok])
      if (worker.ok) expect(geocodeQueryText(text)).toBe(worker.query.text)
    }
  })
})

describe('answer cache', () => {
  it('keys by query and rounded focus', () => {
    expect(answerKey('120', { lat: 40.73, lon: -73.99 })).not.toBe(answerKey('120', null))
    expect(answerKey('120', null)).toBe(answerKey('120', null))
    expect(answerKey('120', { lat: 40.7312, lon: -73.9899 })).toBe(answerKey('120', { lat: 40.73, lon: -73.99 }))
  })

  it('skips incomplete answers, evicts the oldest, and a re-insert refreshes recency', () => {
    const cache = new Map<string, GeocodeResponse>()
    rememberAnswer(cache, 'x', response('X', true), 3)
    expect(cache.size).toBe(0)
    for (const k of ['a', 'b', 'c']) rememberAnswer(cache, k, response(k), 3)
    rememberAnswer(cache, 'a', response('a'), 3)
    rememberAnswer(cache, 'd', response('d'), 3)
    expect([...cache.keys()]).toEqual(['c', 'a', 'd'])
  })
})
