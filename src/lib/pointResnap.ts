/**
 * The point flight's late re-snap (2q7.41). Under reduced motion a point flight (a place, the location button) snaps in
 * its first frame, before the header's ResizeObserver delivers the insets a status line just grew it to, so it lands
 * off-centre. A size or inset change within POINT_RESNAP_WINDOW_MS of the request snaps it once more onto its point in
 * the new free rect, unless anything has moved the camera since (a gesture, another flight, a follow). With motion the
 * in-flight retarget covers it. Pure; useStationFlights applies it.
 */
import type { Ground } from './projection'

/** How long after a reduced-motion point request a size or inset change may still re-snap it. */
export const POINT_RESNAP_WINDOW_MS = 500
/** The camera still sits on the landing: target within this (m), distance within this plus a share of it. */
const POSE_EPS_M = 0.01
const DISTANCE_EPS = 1e-6

/** Where the snapped point flight left the camera, and when it was asked for. */
export interface PointLanding {
  /** performance.now() at the request, ms. */
  at: number
  target: Ground
  distance: number
}

export interface ResnapInput {
  /** performance.now(), ms. */
  now: number
  /** A flight is in progress. */
  flying: boolean
  /** A gesture has begun since the last landing. */
  tookOver: boolean
  /** The camera's target and distance now. */
  target: Ground
  distance: number
}

/** Whether a size or inset change should snap a just-landed reduced-motion point flight once more. */
export function shouldResnapPoint(landing: PointLanding, s: ResnapInput): boolean {
  if (s.flying || s.tookOver) return false
  if (s.now - landing.at > POINT_RESNAP_WINDOW_MS) return false
  const moved = Math.hypot(s.target.x - landing.target.x, s.target.z - landing.target.z)
  return moved <= POSE_EPS_M && Math.abs(s.distance - landing.distance) <= DISTANCE_EPS * landing.distance + POSE_EPS_M
}
