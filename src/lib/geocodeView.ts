/** What the search dialog shows and says about the address lookup (pure). */
import type { GeocodeResult, GeocodeSource } from '../data/realtime'
import type { GeocodeFailure, GeocodeMachine } from './geocodeSearch'

/** While loading: under 400 ms say nothing, then show a line, then (after 2 s) have a screen reader say it too. */
export type SearchingTier = 0 | 1 | 2

export type GeocodeView =
  /** No Worker URL, the dialog is closed, or this dialog doesn't pick places. */
  | { status: 'off' }
  /** The text is under 3 (or over 100) code points. */
  | { status: 'short' }
  /** Debouncing or loading; `places` are the previous answer's, kept so the list doesn't flicker. */
  | { status: 'pending'; tier: SearchingTier; places: readonly GeocodeResult[]; sources: readonly GeocodeSource[] }
  | { status: 'ready'; places: readonly GeocodeResult[]; sources: readonly GeocodeSource[] }
  | { status: 'error'; error: GeocodeFailure }

export const GEOCODE_ERROR_TEXT = "Address search isn't available right now."

const SOURCE_ORDER: readonly GeocodeSource[] = ['geosearch', 'photon']

/** Streets are the on-device search's (2q7.14); the Worker's other rows show. */
function shownPlaces(results: readonly GeocodeResult[]): { places: GeocodeResult[]; sources: GeocodeSource[] } {
  const places = results.filter((r) => r.kind !== 'street')
  return { places, sources: SOURCE_ORDER.filter((s) => places.some((r) => r.source === s)) }
}

export function geocodeView(m: GeocodeMachine, enabled: boolean, tier: SearchingTier): GeocodeView {
  if (!enabled) return { status: 'off' }
  switch (m.phase) {
    case 'idle':
      return { status: 'short' }
    case 'debouncing':
    case 'loading':
      return { status: 'pending', tier: m.phase === 'loading' ? tier : 0, ...shownPlaces(m.shown?.response.results ?? []) }
    case 'settled':
      if (m.error) return { status: 'error', error: m.error }
      return m.shown ? { status: 'ready', ...shownPlaces(m.shown.response.results) } : { status: 'short' }
  }
}

/** The polite live region's text: one sentence per settled query, never one per keystroke. */
export function geocodeAnnouncement(v: GeocodeView): string {
  switch (v.status) {
    case 'off':
    case 'short':
      return ''
    case 'pending':
      return v.tier === 2 ? 'Still searching addresses and places' : ''
    case 'ready':
      if (v.places.length === 0) return 'No addresses or places match'
      return v.places.length === 1 ? '1 address or place' : `${v.places.length} addresses and places`
    case 'error':
      return GEOCODE_ERROR_TEXT.replace(/\.$/, '')
  }
}

/** The visible "nothing here" line (aria-hidden: the status regions speak it). Null until typed, and while anything matches. */
export function searchEmptyText(typed: boolean, stationCount: number, v: GeocodeView): string | null {
  if (!typed || stationCount > 0) return null
  switch (v.status) {
    case 'off':
    case 'short':
    case 'error':
      return 'No stations match.'
    case 'pending':
      // The "Searching…" line covers it; an earlier answer's rows are still listed.
      return null
    case 'ready':
      return v.places.length === 0 ? 'No stations or places match.' : null
  }
}

/**
 * The unavailable sentence is spoken once per dialog session: `none` until an error shows, `speaking` while that error
 * is up, `spoken` after it clears (a later error is silent), and back to `none` when the dialog closes.
 */
export type ErrorSpoken = 'none' | 'speaking' | 'spoken'

export function nextErrorSpoken(prev: ErrorSpoken, v: GeocodeView, open: boolean): ErrorSpoken {
  if (!open) return 'none'
  if (v.status === 'error') return prev === 'none' ? 'speaking' : prev
  return prev === 'speaking' ? 'spoken' : prev
}

/** `geocodeAnnouncement`, but an error already spoken this session says nothing. */
export function announcementFor(v: GeocodeView, errorSpoken: ErrorSpoken): string {
  return v.status === 'error' && errorSpoken === 'spoken' ? '' : geocodeAnnouncement(v)
}
