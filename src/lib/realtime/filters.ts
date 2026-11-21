import type { RealtimeTrip } from '../../data/realtime'

/** Thresholds measured on one Friday-evening snapshot (see 8x4.6 plan); re-measure before tuning. */
export const GHOST = {
  /** A VehiclePosition older than this is a stuck or abandoned train. */
  staleVehicleS: 1800,
  /** Arrivals this far in the past still count as "about to leave". */
  pastArrivalGraceS: 60,
  /** A train whose origin departure is further away than this stays hidden. */
  notDepartedS: 120,
} as const

export type GhostReason = 'unassigned' | 'stale-vehicle' | 'no-future-arrival'

/** Why a trip should not be drawn, judged from the feed alone (no static data); null when it should. */
export function ghostReason(trip: RealtimeTrip, now: number): GhostReason | null {
  if (!trip.assigned) return 'unassigned'
  if (trip.timestamp !== null && now - trip.timestamp > GHOST.staleVehicleS) return 'stale-vehicle'
  if (!trip.arrivals.some(([, t]) => t >= now - GHOST.pastArrivalGraceS)) return 'no-future-arrival'
  return null
}
