/** HUD text for a locate state. Pure. Never includes coordinates. */
import type { LocateFailure, LocateState } from './locate'

export interface LocateAction {
  label: string
  stationId: string
}

export interface LocateMessage {
  tone: 'info' | 'warn' | 'error'
  text: string
  action?: LocateAction
  /** Announced to screen readers only; the location button's active colour is the visible cue. */
  srOnly?: boolean
}

const METERS_PER_MILE = 1609.344

/** Distance in miles for the HUD: "about 2.6 mi", "under 0.1 mi". */
export function formatDistance(meters: number): string {
  const miles = meters / METERS_PER_MILE
  if (miles < 0.1) return 'under 0.1 mi'
  return `about ${miles.toFixed(1)} mi`
}

const FAILURE_TEXT: Record<LocateFailure, string> = {
  denied: 'Location is blocked. Allow it for this site in your browser (or turn on Location Services), then try again.',
  unavailable: "Couldn't find your location. Try again in a moment.",
  timeout: 'Finding your location took too long. Try again.',
  unsupported: "This browser can't share your location.",
}

export function locateMessage(state: LocateState): LocateMessage | null {
  switch (state.status) {
    case 'idle':
      return null
    case 'locating':
      return { tone: 'info', text: 'Finding your location…' }
    case 'failed':
      return { tone: state.reason === 'denied' ? 'warn' : 'error', text: FAILURE_TEXT[state.reason] }
    case 'located': {
      const p = state.placement
      const goTo = { label: `Go to ${p.nearest.name}`, stationId: p.nearest.id }
      if (p.kind === 'outside') return { tone: 'warn', text: "You're outside the area this map covers.", action: goTo }
      if (p.kind === 'far') {
        return { tone: 'info', text: `You're ${formatDistance(p.nearest.distanceM)} from the nearest station.`, action: goTo }
      }
      return {
        tone: 'info',
        text: p.approximate
          ? `Showing where you are (approximate, within ${formatDistance(p.accuracyM)}).`
          : 'Showing where you are.',
        srOnly: true,
      }
    }
  }
}
