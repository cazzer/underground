import { EXIT_DISTANCE } from './focusMachine'
import type { Ground } from './projection'

/** Zooming out past this multiple of the cancel-point distance releases the hold. */
export const HOLD_ZOOM_OUT = 1.25
/** Panning farther than this fraction of the camera distance (capped at the cancel point's) releases the hold. */
export const HOLD_PAN = 0.3

/**
 * A clicked station whose fly-to was interrupted by user input. Its focus is held so the panel
 * doesn't drop just because the camera stopped short of the station.
 */
export interface FocusHold {
  stationId: string
  /** Camera distance when the flight was cancelled. */
  distance: number
  /** View center when the flight was cancelled. */
  target: Ground
}

/** True once the normal camera-driven focus rules should take over again. */
export function shouldReleaseHold(hold: FocusHold, distance: number, target: Ground): boolean {
  if (distance <= EXIT_DISTANCE) return true
  if (distance > hold.distance * HOLD_ZOOM_OUT) return true
  // Measured against the closer of the two distances: after zooming in, a smaller pan is deliberate.
  const panned = Math.hypot(target.x - hold.target.x, target.z - hold.target.z)
  return panned > Math.min(hold.distance, distance) * HOLD_PAN
}
