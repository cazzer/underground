import { EXIT_DISTANCE, EXIT_RADIUS } from './focusMachine'
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
  /** The held station's ground position. */
  station: Ground
  /** Camera distance when the flight was cancelled. */
  distance: number
  /** View center when the flight was cancelled. */
  target: Ground
  /** The positions of every station of the held one's complex (itself included), when it is one: the interior flight aims at their hull. */
  members?: readonly Ground[]
}

/** The ground positions of the stations in `group` (a complex's members); undefined for none. Allocates: call it once per hold. */
export function groupPositions(group: ReadonlySet<string>, stationById: ReadonlyMap<string, { pos: Ground }>): Ground[] | undefined {
  if (group.size === 0) return undefined
  const out: Ground[] = []
  for (const id of group) {
    const s = stationById.get(id)
    if (s) out.push(s.pos)
  }
  return out
}

/**
 * True once the normal camera-driven focus rules should take over again: inside the focus range and near
 * enough that they keep the held station (a flight cut short mid-pan can stop inside EXIT_DISTANCE but
 * farther than EXIT_RADIUS from it), or after a deliberate zoom out or pan.
 */
export function shouldReleaseHold(hold: FocusHold, distance: number, target: Ground): boolean {
  // From the nearest member of a complex: its interior flight lands on the hull centre, between them.
  let off = Math.hypot(target.x - hold.station.x, target.z - hold.station.z)
  for (const m of hold.members ?? []) off = Math.min(off, Math.hypot(target.x - m.x, target.z - m.z))
  if (distance <= EXIT_DISTANCE && off <= EXIT_RADIUS) return true
  if (distance > hold.distance * HOLD_ZOOM_OUT) return true
  // Measured against the closer of the two distances: after zooming in, a smaller pan is deliberate.
  const panned = Math.hypot(target.x - hold.target.x, target.z - hold.target.z)
  return panned > Math.min(hold.distance, distance) * HOLD_PAN
}
