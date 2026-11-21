import type { FeedId, RealtimeTrip } from '../../data/realtime'
import type { StopId } from '../../data/schema'

/**
 * The last stop a train was seen at, carried across polls. MTA predictions for the final approach run late
 * (about 40 s on a replay of 32 polls), while the schedule from the last stop is within seconds, so
 * `planHop` caps a predicted arrival with this visit plus the scheduled run (underground-d80).
 */
export interface StopVisit {
  stopId: StopId
  /** Epoch s: the earliest evidence of the train at the stop (its STOPPED_AT VehiclePosition time). */
  arrivedAt: number
  /** Epoch s: the latest time it was known to still be at the platform; `arrivedAt` where the feed can't tell. */
  seenAt: number
}

/**
 * Feeds whose STOPPED_AT lingers after the train leaves (the stop drops out of its arrivals, or doesn't),
 * so the status dates the arrival but says nothing about the dwell. Measured on the replay: only the
 * 1234567 and L feeds switch to IN_TRANSIT_TO when the train leaves.
 */
const LINGERING_STOPPED_AT: ReadonlySet<FeedId> = new Set<FeedId>(['ace', 'bdfm', 'g', 'jz', 'nqrw', 'si'])

/**
 * Updates a trip's visit from one poll. STOPPED_AT dates the arrival (the earliest VehiclePosition time
 * seen at that stop) and, on feeds that leave it when the train does, places the train at the platform as
 * of the feed header. Any other status carries the previous visit. Pure; runs once per trip per poll.
 */
export function nextVisit(
  prev: StopVisit | null,
  trip: RealtimeTrip,
  feed: FeedId,
  headerTimestamp: number | null,
): StopVisit | null {
  const { status, stopId, timestamp } = trip
  if (status !== 'STOPPED_AT' || stopId === null || timestamp === null) return prev
  const same = prev?.stopId === stopId
  const arrivedAt = same ? Math.min(prev.arrivedAt, timestamp) : timestamp
  if (LINGERING_STOPPED_AT.has(feed)) return { stopId, arrivedAt, seenAt: arrivedAt }
  const seenNow = Math.max(timestamp, headerTimestamp ?? timestamp)
  return { stopId, arrivedAt, seenAt: same ? Math.max(prev.seenAt, seenNow) : seenNow }
}
