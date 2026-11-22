import { interiorCovers, siblingIdsOf, type IndexLoad } from '../data/interiorLoad'
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
  /**
   * The same for `dismissedId`: the closed station's complex. Its panel stays closed for the whole complex (a view
   * centered on a sibling doesn't reopen it as that sibling), and the dismissal clears only once the view has left
   * every member by EXIT_RADIUS. Ignored unless it holds `dismissedId`.
   */
  dismissedGroup: ReadonlySet<string>
}

/** No complex: the focused station stands alone (the rules measure from its own point). */
export const NO_FOCUS_GROUP: ReadonlySet<string> = new Set()

/**
 * The complex `id` belongs to, from the station index (which still lists it once the interior has unloaded, as when
 * the panel closes): `id` and its siblings, or NO_FOCUS_GROUP for a lone station or an index that isn't ready. When
 * the loaded `interior` covers `id`, the group is cut to the members it really draws (a stale index can't widen
 * it). Allocates, so call it when the index or the id changes, never per frame.
 */
export function focusGroupOf(
  id: string | null,
  index: IndexLoad,
  interior: { stationId: string; memberStationIds?: readonly string[] } | null,
): ReadonlySet<string> {
  if (id === null) return NO_FOCUS_GROUP
  const siblings = siblingIdsOf(id, index)
  if (siblings.length === 0) return NO_FOCUS_GROUP
  const members = [id, ...siblings]
  const drawn = interiorCovers(interior, id) ? members.filter((m) => interiorCovers(interior, m)) : members
  return drawn.length > 1 ? new Set(drawn) : NO_FOCUS_GROUP
}

/**
 * Next focus state for the camera's current position. Returns `input` itself when nothing
 * changes, so callers can skip a state update with an identity check. Runs every frame, so
 * it does not allocate unless the state changes.
 */
export function nextFocus(input: FocusInput): FocusState {
  const { focusedId, dismissedId, distance, target, stations, settled, focusGroup, dismissedGroup } = input
  const grouped = focusedId !== null && focusGroup.has(focusedId)
  const dismissedGrouped = dismissedId !== null && dismissedGroup.has(dismissedId)
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
    if (s.id === dismissedId || (dismissedGrouped && dismissedGroup.has(s.id))) dd = Math.min(dd, d)
  }

  const dismissed = dismissedId && (distance > EXIT_DISTANCE || dd > EXIT_RADIUS) ? null : dismissedId
  let focused = focusedId && (distance > EXIT_DISTANCE || fd > EXIT_RADIUS) ? null : focusedId
  if (distance < ENTER_DISTANCE && nd < ENTER_RADIUS) {
    if (nearest === dismissed || (dismissed !== null && dismissedGrouped && nearest !== null && dismissedGroup.has(nearest))) {
      // Centered on a station the user closed (or one of its complex): don't leave a neighbour's panel up either.
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
