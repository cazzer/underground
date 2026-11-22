/**
 * The address search's debounce and abort state machine (pure: events in, state and effects out). The hook that
 * runs it (`useGeocode`) owns the timer, the request and the cache; nothing here reads a clock or the network.
 */
import { normalizeQuery, type GeocodeResponse } from '../data/realtime'
import { focusParam } from './geocodeFocus'
import type { LatLon } from './projection'

/** Code points of normalized text; equals the Worker's floor, so a shorter query is never sent. */
export const GEOCODE_MIN_CHARS = 3
/** The Worker's ceiling; longer text sends nothing. */
export const GEOCODE_MAX_CHARS = 100
export const GEOCODE_DEBOUNCE_MS = 250
export const ANSWER_CACHE_MAX = 50

export type GeocodeFailure = 'busy' | 'upstream' | 'rejected' | 'network' | 'timeout' | 'bad-response' | 'schema'

export type GeocodeAnswer =
  | { ok: true; response: GeocodeResponse }
  | { ok: false; error: GeocodeFailure; status: number | null }

export interface GeocodeShown {
  query: string
  response: GeocodeResponse
}

export interface GeocodeMachine {
  /** Normalized; '' when the text is out of range or the machine was reset. */
  query: string
  /** Bumps on every query change; timers and answers carry it, and a stale one is ignored. */
  seq: number
  phase: 'idle' | 'debouncing' | 'loading' | 'settled'
  /** The last good answer; may belong to an older query while debouncing or loading. */
  shown: GeocodeShown | null
  /** For `query`, when it settled with a failure. */
  error: GeocodeFailure | null
}

export const INITIAL_GEOCODE: GeocodeMachine = { query: '', seq: 0, phase: 'idle', shown: null, error: null }

export type GeocodeEvent =
  | { type: 'input'; text: string }
  | { type: 'fire'; seq: number; focus: LatLon | null; cached: GeocodeResponse | null }
  | { type: 'answer'; seq: number; answer: GeocodeAnswer }
  | { type: 'reset' }

export type GeocodeEffect =
  /** Clear the timer and abort the request in flight. */
  | { type: 'cancel' }
  | { type: 'schedule'; seq: number; delayMs: number }
  | { type: 'fetch'; seq: number; query: string; focus: LatLon | null }

/** The text a request would carry: normalized as the Worker does, null outside 3 to 100 code points. */
export function geocodeQueryText(text: string): string | null {
  const normalized = normalizeQuery(text)
  const length = Array.from(normalized).length
  return length >= GEOCODE_MIN_CHARS && length <= GEOCODE_MAX_CHARS ? normalized : null
}

interface Step {
  next: GeocodeMachine
  effects: GeocodeEffect[]
}

const isEmpty = (m: GeocodeMachine) => m.query === '' && m.phase === 'idle' && m.shown === null && m.error === null

function onInput(m: GeocodeMachine, text: string): Step {
  const query = geocodeQueryText(text)
  if (query === null) {
    return geocodeStep(m, { type: 'reset' })
  }
  if (query === m.query) return { next: m, effects: [] }
  const seq = m.seq + 1
  return {
    next: { query, seq, phase: 'debouncing', shown: m.shown, error: null },
    effects: [{ type: 'cancel' }, { type: 'schedule', seq, delayMs: GEOCODE_DEBOUNCE_MS }],
  }
}

export function geocodeStep(m: GeocodeMachine, e: GeocodeEvent): Step {
  switch (e.type) {
    case 'input':
      return onInput(m, e.text)
    case 'fire':
      if (e.seq !== m.seq || m.phase !== 'debouncing') return { next: m, effects: [] }
      if (e.cached) return { next: { ...m, phase: 'settled', shown: { query: m.query, response: e.cached }, error: null }, effects: [] }
      return { next: { ...m, phase: 'loading' }, effects: [{ type: 'fetch', seq: e.seq, query: m.query, focus: e.focus }] }
    case 'answer':
      if (e.seq !== m.seq || m.phase !== 'loading') return { next: m, effects: [] }
      return e.answer.ok
        ? { next: { ...m, phase: 'settled', shown: { query: m.query, response: e.answer.response }, error: null }, effects: [] }
        : { next: { ...m, phase: 'settled', shown: null, error: e.answer.error }, effects: [] }
    // A late timer or answer of the old query must not land: the seq moves on.
    case 'reset':
      return isEmpty(m) ? { next: m, effects: [] } : { next: { ...INITIAL_GEOCODE, seq: m.seq + 1 }, effects: [{ type: 'cancel' }] }
  }
}

/** The session cache's key: the normalized query and the rounded focus it was asked with. */
export function answerKey(query: string, focus: LatLon | null): string {
  return `${query}|${focus ? focusParam(focus) : ''}`
}

/** Remembers a complete answer (an incomplete one is never kept, so a retry can do better), newest last, oldest out above `max`. */
export function rememberAnswer(cache: Map<string, GeocodeResponse>, key: string, response: GeocodeResponse, max = ANSWER_CACHE_MAX): void {
  if (response.incomplete) return
  cache.delete(key)
  cache.set(key, response)
  while (cache.size > max) {
    const oldest = cache.keys().next()
    if (oldest.done) return
    cache.delete(oldest.value)
  }
}
