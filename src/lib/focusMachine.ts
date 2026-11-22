import { interiorCovers, interiorStationIds } from '../data/interiorLoad'
import type { Station } from './network'
import type { Ground } from './projection'

/**
 * Zooming inside ENTER_DISTANCE with a station within ENTER_RADIUS of the view center focuses it, once the view
 * has settled (focusDwell.ts), so a pan across the city doesn't flick panels open. It is the interior reveal's far
 * end (REVEAL_FAR), where the tilt first shows, so a focused station's plan fades in from nothing.
 */
export const ENTER_DISTANCE = 1250
export const ENTER_RADIUS = 140
/**
 * Focus is dropped once zoomed out past EXIT_DISTANCE or panned EXIT_RADIUS from the focused station. It is the
 * tilt's top-down distance (DEFAULT_TILT.farDistance), so a view that loses focus is already flat.
 */
export const EXIT_DISTANCE = 1450
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
  /** The view has held still long enough to enter a station (focusDwell's `settled`). Exits never wait. */
  settled: boolean
  /**
   * The stations that share the focused station's interior (a complex's members, the focused one included), or
   * NO_FOCUS_GROUP. An interior flight lands on the complex's hull centre, which can be farther than ENTER_RADIUS or
   * EXIT_RADIUS from the focused member's own point, so the focused distance is the nearest member's and focus never
   * switches to another member. Ignored unless it holds `focusedId`.
   */
  focusGroup: ReadonlySet<string>
}

/** No complex: the focused station stands alone (the rules measure from its own point). */
export const NO_FOCUS_GROUP: ReadonlySet<string> = new Set()

/**
 * The focus group of the interior that covers `focusedId`: its members when it is a complex, else none. Allocates,
 * so call it when the interior or the focus changes, never per frame.
 */
export function focusGroupFor(
  interior: { stationId: string; memberStationIds?: readonly string[] } | null,
  focusedId: string | null,
): ReadonlySet<string> {
  if (!interior || !interiorCovers(interior, focusedId)) return NO_FOCUS_GROUP
  const ids = interiorStationIds(interior)
  return ids.length > 1 ? new Set(ids) : NO_FOCUS_GROUP
}

/**
 * Next focus state for the camera's current position. Returns `input` itself when nothing
 * changes, so callers can skip a state update with an identity check. Runs every frame, so
 * it does not allocate unless the state changes.
 */
export function nextFocus(input: FocusInput): FocusState {
  const { focusedId, dismissedId, distance, target, stations, settled, focusGroup } = input
  const grouped = focusedId !== null && focusGroup.has(focusedId)
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
    // Focused distance: from the focused station, or from the nearest member of its complex.
    if (s.id === focusedId || (grouped && focusGroup.has(s.id))) fd = Math.min(fd, d)
    if (s.id === dismissedId) dd = d
  }

  const dismissed = dismissedId && (distance > EXIT_DISTANCE || dd > EXIT_RADIUS) ? null : dismissedId
  let focused = focusedId && (distance > EXIT_DISTANCE || fd > EXIT_RADIUS) ? null : focusedId
  if (distance < ENTER_DISTANCE && nd < ENTER_RADIUS) {
    if (nearest === dismissed) {
      // Centered on a station the user closed: don't leave a neighbour's panel up either.
      focused = null
    } else if (settled && (focused === null || fd > ENTER_RADIUS) && !(grouped && nearest !== null && focusGroup.has(nearest))) {
      // Switch only once the current station is clearly behind, so neighbours don't flip-flop, and never to
      // another member of the focused complex: they share its interior.
      focused = nearest
    }
  }

  if (focused === focusedId && dismissed === dismissedId) return input
  return { focusedId: focused, dismissedId: dismissed }
}
