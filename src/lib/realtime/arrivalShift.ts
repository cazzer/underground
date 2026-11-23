import type { FeedId } from '../../data/realtime'
import { MAX_CRUISE_MPS } from './runEase'

/**
 * Seconds every predicted arrival is shown sooner, per feed. The client sees a feed about 23 s after the train
 * reached the platform (the feed's own delay, the Worker's 15 s memo, the 15 s poll), and the final-approach
 * predictions run another 34 to 48 s late, of which the cap in stopVisit.ts takes only part. Replaying an hour of
 * polls (2026-11-23, 10,087 timed arrivals) with no shift put a dot at the platform a median 9.6 s late (8% more than
 * 30 s) and kept a minute count on the station panel after the train was in on 86% of arrivals. With these values
 * the median is early, under 2% are more than 30 s late and the panel reads "Now" in time on over 80%. The feeds
 * differ in how late the feed itself is (the L feed's headers and positions lag most, NQRW's least).
 *
 * Departures are never shifted.
 */
export const ARRIVAL_SHIFT_S: Readonly<Record<FeedId, number>> = {
  '1234567': 25,
  ace: 20,
  bdfm: 20,
  g: 20,
  jz: 20,
  nqrw: 10,
  l: 30,
  si: 20,
}

/** A hop is pulled in by at most this share of its running time (its run less the dwell): a short hop is never mostly pulled forward. */
export const ARRIVAL_SHIFT_MAX_SHARE = 0.5

/** What the panels show for a predicted arrival. */
export const shownArrival = (feed: FeedId, predicted: number): number => predicted - ARRIVAL_SHIFT_S[feed]

/**
 * The part of `shiftS` a hop of `distanceM` that runs `moveS` seconds (its run less the dwell) can take: at most
 * `ARRIVAL_SHIFT_MAX_SHARE` of the run, and never so much that the average speed would pass MAX_CRUISE_MPS.
 * `planHop` gives the same seconds to the dwell, so the leave time stays put.
 */
export const hopArrivalShift = (shiftS: number, moveS: number, distanceM: number): number =>
  Math.max(0, Math.min(shiftS, ARRIVAL_SHIFT_MAX_SHARE * moveS, moveS - distanceM / MAX_CRUISE_MPS))
