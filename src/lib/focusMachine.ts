import type { Station } from './network'
import type { Ground } from './projection'

/** Zooming inside ENTER_DISTANCE with a station within ENTER_RADIUS of the view center focuses it. */
export const ENTER_DISTANCE = 1100
export const ENTER_RADIUS = 140
/** Focus is dropped once zoomed out past EXIT_DISTANCE or panned EXIT_RADIUS from the focused station. */
export const EXIT_DISTANCE = 1400
export const EXIT_RADIUS = 350

export interface FocusState {
  focusedId: string | null
  /** Station the user closed; auto-focus is suppressed for it until the camera leaves its area. */
  dismissedId: string | null
}

export interface FocusInput extends FocusState {
  /** Camera distance to its target, meters. */
  distance: number
  /** View center on the ground plane. */
  target: Ground
  stations: readonly Station[]
}

/**
 * Next focus state for the camera's current position. Returns `input` itself when nothing
 * changes, so callers can skip a state update with an identity check. Runs every frame, so
 * it does not allocate unless the state changes.
 */
export function nextFocus(input: FocusInput): FocusState {
  const { focusedId, dismissedId, distance, target, stations } = input
  let nearest: string | null = null
  let nd = Infinity
  let fd = Infinity
  let dd = Infinity
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i]!
    const d = Math.hypot(s.pos.x - target.x, s.pos.z - target.z)
    if (d < nd) {
      nd = d
      nearest = s.id
    }
    if (s.id === focusedId) fd = d
    if (s.id === dismissedId) dd = d
  }

  const dismissed = dismissedId && (distance > EXIT_DISTANCE || dd > EXIT_RADIUS) ? null : dismissedId
  let focused = focusedId && (distance > EXIT_DISTANCE || fd > EXIT_RADIUS) ? null : focusedId
  if (distance < ENTER_DISTANCE && nd < ENTER_RADIUS) {
    if (nearest === dismissed) {
      // Centered on a station the user closed: don't leave a neighbour's panel up either.
      focused = null
    } else if (focused === null || fd > ENTER_RADIUS) {
      // Switch only once the current station is clearly behind, so neighbours don't flip-flop.
      focused = nearest
    }
  }

  if (focused === focusedId && dismissed === dismissedId) return input
  return { focusedId: focused, dismissedId: dismissed }
}
