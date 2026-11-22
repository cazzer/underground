/** When the view has settled enough for auto-focus to enter a station: pure, no allocation. */
import type { Ground } from './projection'

/** How long the view must hold still (seconds) before auto-focus may enter a station. */
export const ENTER_DWELL_S = 0.4
/**
 * Movement that still counts as holding still, as a fraction of the camera distance: 2 m at 1000 m, about
 * 3 px on a phone, so the last of the controls' damping doesn't keep restarting the wait.
 */
export const STILL_FRACTION = 0.002

/** The pose the view has held since `since` (seconds, the caller's clock). */
export interface DwellState {
  since: number
  x: number
  z: number
  distance: number
}

export function newDwell(): DwellState {
  return { since: -Infinity, x: NaN, z: NaN, distance: NaN }
}

/**
 * Updates `state` for this frame and returns true once the view has held still for ENTER_DWELL_S: the target and
 * distance within STILL_FRACTION × distance of the pose the wait started at, with no gesture active. Any move
 * past that, or a gesture, restarts the wait from `now`.
 */
export function settled(state: DwellState, now: number, target: Ground, distance: number, gesture: boolean): boolean {
  const eps = STILL_FRACTION * distance
  const moved =
    !(Math.abs(target.x - state.x) <= eps && Math.abs(target.z - state.z) <= eps && Math.abs(distance - state.distance) <= eps)
  if (gesture || moved) {
    state.since = now
    state.x = target.x
    state.z = target.z
    state.distance = distance
    return false
  }
  return now - state.since >= ENTER_DWELL_S
}
