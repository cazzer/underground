import { STALE_AFTER_S, type FeedId, type RealtimeSnapshot, type RealtimeTrip } from '../../data/realtime'
import type { StationId, StopId } from '../../data/schema'
import { NOW_UNDER_S, PAST_GRACE_S, stationOfStop } from './arrivals'
import { DELAYED_NOTE } from './arrivalsView'
import type { LiveStatus } from './liveStatus'

export interface TrainStop {
  stopId: StopId
  /** The station's name; the stop id when the station is not in the static data. */
  name: string
  /** Predicted epoch seconds. */
  time: number
  /** The train is stopped here now; once its predicted time has passed, the row says only "Now". */
  standing: boolean
}

/**
 * The stops the train has yet to reach, in feed order. A stop whose time is up to PAST_GRACE_S past is kept (it
 * reads "Now"), and so is the first one while the train is stopped at it, however long it dwells.
 */
export function nextStops(
  trip: Pick<RealtimeTrip, 'arrivals' | 'status' | 'stopId'>,
  nowS: number,
  stationName: (id: StationId) => string | undefined,
): TrainStop[] {
  const first = trip.arrivals[0]
  const dwelling = trip.status === 'STOPPED_AT' && first !== undefined && first[0] === trip.stopId
  return trip.arrivals
    .map(([stopId, time], i) => ({ stopId, name: stationName(stationOfStop(stopId)) ?? stopId, time, standing: i === 0 && dwelling }))
    .filter((stop) => stop.standing || stop.time >= nowS - PAST_GRACE_S)
}

/** Whether the feed's list ends before the trip does (the Worker cuts arrivals at its horizon). */
export function isCutShort(stops: readonly TrainStop[], terminal: StopId | undefined): boolean {
  const last = stops.at(-1)
  return terminal !== undefined && last !== undefined && last.stopId !== terminal
}

/** Whether times may be late: the connection is failing, the snapshot is old, or this train's feed is stale. */
export function tripTimesDelayed(snapshot: RealtimeSnapshot, feed: FeedId, failures: number, nowS: number): boolean {
  return failures >= 2 || nowS - snapshot.generatedAt > STALE_AFTER_S || snapshot.feeds[feed].stale
}

const NY_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h12',
})

/** New York wall-clock time on a 12 hour clock without AM/PM: "12:41", "12:05". */
export function nyClockTime(epochS: number): string {
  return NY_CLOCK.formatToParts(epochS * 1000)
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim()
}

export interface StopEta {
  clock: string
  /** "Now" or "3 min". */
  away: string
}

/**
 * "Now" under 30 s away (or past), else whole minutes counted on the clock face: the arrival's clock minute
 * minus the current one, so a row reads "1:50 · 6 min" and the next "1:52 · 8 min" (rounding the distances
 * instead would disagree with the clock times beside them). Never less than 1.
 */
export function stopEta(time: number, nowS: number): StopEta {
  const clock = nyClockTime(time)
  if (time - nowS < NOW_UNDER_S) return { clock, away: 'Now' }
  return { clock, away: `${Math.max(1, Math.floor(time / 60) - Math.floor(nowS / 60))} min` }
}

/** Screen-reader text for a row's time: "1:46, in 2 minutes", or "now". The visible clock and minutes are hidden. */
export function stopEtaSpoken(eta: StopEta): string {
  if (eta.away === 'Now') return 'now'
  const minutes = Number.parseInt(eta.away, 10)
  return `${eta.clock}, in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
}

/** What the next-stops list shows: a message alone, or rows (possibly none) under optional notes. */
export type TrainStopsView =
  | { kind: 'message'; text: string }
  | { kind: 'empty'; notes: string[] }
  | { kind: 'rows'; stops: TrainStop[]; notes: string[] }

/**
 * Which state the list is in. `stops` is null until there is a snapshot to read the clock from. Delayed data
 * (see tripTimesDelayed) keeps its times under a note; `status` only decides off and error.
 */
export function deriveTrainStopsView(status: LiveStatus, stops: TrainStop[] | null, delayed: boolean): TrainStopsView {
  if (status.kind === 'off') return { kind: 'message', text: 'Live times not available yet' }
  if (status.kind === 'error') return { kind: 'message', text: 'Live times unavailable' }
  if (stops === null) return { kind: 'message', text: 'Connecting to live times' }
  const notes = delayed ? [DELAYED_NOTE] : []
  return stops.length === 0 ? { kind: 'empty', notes } : { kind: 'rows', stops, notes }
}
