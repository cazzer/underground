import type { FeedId, RealtimeTrip } from '../../data/realtime'
import type { StopId } from '../../data/schema'

/**
 * The last stop a train was seen at, carried across polls. MTA predictions for the final approach run late
 * (about 40 s on a replay of 32 polls), while the schedule from the last stop is within seconds, so
 * `planHop` caps a predicted arrival with this visit plus the scheduled run (underground-d80). The cap takes part of
 * that bias; the rest, with the delay in getting the feed here, is the per-feed shift in arrivalShift.ts.
 */
export interface StopVisit {
  stopId: StopId
  /** Epoch s: the earliest evidence of the train at the stop (its STOPPED_AT VehiclePosition time). */
  arrivedAt: number
  /**
   * Epoch s: the train did not leave before this (the latest header, or the stop's own predicted time, while
   * it was known to be at the platform); null where the feed never placed it there.
   */
  leftAfter: number | null
  /** This poll still places the train at the platform, so its departure is unknown and nothing is capped. */
  here: boolean
}

/**
 * Feeds whose STOPPED_AT lingers after the train leaves, so the status dates the arrival but says nothing
 * about the dwell. The data rule below (the stop's own time still ahead of the header) never fires on them in
 * the replay, and on the 1234567 feed it misses most trains at the platform (904 of 1635 STOPPED_AT polls have
 * the stop's time behind the header; 462 of those are still STOPPED_AT there the next poll), so the list stays.
 */
const LINGERING_STOPPED_AT: ReadonlySet<FeedId> = new Set<FeedId>(['ace', 'bdfm', 'g', 'jz', 'nqrw', 'si'])

/**
 * Updates a trip's visit from one poll. STOPPED_AT dates the arrival (the earliest VehiclePosition time seen
 * at that stop). The train is at the platform when the feed leaves STOPPED_AT on departure (1234567, L), or when
 * the stop's own predicted time is still at or after the header (it leaves then); while there, `leftAfter`
 * advances to the header and to that time. Any other status keeps the visit, no longer `here`. Pure; once per
 * trip per poll.
 */
export function nextVisit(
  prev: StopVisit | null,
  trip: RealtimeTrip,
  feed: FeedId,
  headerTimestamp: number | null,
): StopVisit | null {
  const { status, stopId, timestamp } = trip
  if (status !== 'STOPPED_AT' || stopId === null || timestamp === null) {
    return prev?.here ? { ...prev, here: false } : prev
  }
  const same = prev?.stopId === stopId
  const arrivedAt = same ? Math.min(prev.arrivedAt, timestamp) : timestamp
  const header = headerTimestamp ?? timestamp
  const own = trip.arrivals.find((a) => a[0] === stopId)?.[1]
  const here = !LINGERING_STOPPED_AT.has(feed) || (own !== undefined && own >= header)
  const before = same ? prev.leftAfter : null
  if (!here) return { stopId, arrivedAt, leftAfter: before, here }
  const seen = Math.max(header, own ?? header)
  return { stopId, arrivedAt, leftAfter: before === null ? seen : Math.max(before, seen), here }
}

/**
 * Added to the schedule bound. Trains run a median 6 s slower than the scheduled segment between consecutive
 * STOPPED_ATs (replay of 32 polls), and a dot that sits in a station its train hasn't reached reads as more wrong
 * than a few seconds of lag.
 */
export const SCHEDULE_CAP_SLACK_S = 6
/**
 * The most the cap may pull a prediction in: the measured final-approach bias (about 42 s). A train held where
 * the feed can't show it (an incident, a timing point) shows up this late at worst, not minutes early.
 */
export const MAX_PULL_IN_S = 45

/**
 * The arrival at the stop after `fromStop`, from the prediction and the visit there. A train the poll still places
 * at that platform is never shown leaving before it was last known there (`leftAfter`): its arrival is at least
 * that plus the run less the dwell, and nothing pulls it in, since it may yet be held. Once it has left, the
 * prediction is capped by the schedule: no later than the arrival there plus the run (arrival to arrival), nor
 * than `leftAfter` plus the run less the dwell, plus the slack; never more than `MAX_PULL_IN_S` sooner.
 */
export function capArrival(
  predicted: number,
  fromStop: StopId,
  runS: number,
  dwellS: number,
  visit: StopVisit,
  /** False leaving the trip's origin: only the floor for a train still there applies. */
  mayCap: boolean,
): number {
  if (visit.stopId !== fromStop) return predicted
  const departed = visit.leftAfter === null ? -Infinity : visit.leftAfter + runS - dwellS
  if (visit.here) return Math.max(predicted, departed)
  if (!mayCap) return predicted
  const bound = Math.max(visit.arrivedAt + runS, departed) + SCHEDULE_CAP_SLACK_S
  return Math.max(Math.min(predicted, bound), predicted - MAX_PULL_IN_S)
}
