import type { RealtimeTrip } from '../../data/realtime'
import type { StationId, StopId } from '../../data/schema'
import { PAST_GRACE_S, minutesText, stationOfStop } from './arrivals'
import { DELAYED_NOTE } from './arrivalsView'
import type { LiveStatus } from './liveStatus'

export interface TrainStop {
  stopId: StopId
  /** The station's name; the stop id when the station is not in the static data. */
  name: string
  /** Predicted epoch seconds. */
  time: number
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
    .filter(([, time], i) => time >= nowS - PAST_GRACE_S || (i === 0 && dwelling))
    .map(([stopId, time]) => ({ stopId, name: stationName(stationOfStop(stopId)) ?? stopId, time }))
}

const NY_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: 'numeric',
  minute: '2-digit',
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

export function stopEta(time: number, nowS: number): StopEta {
  const minutes = minutesText(time - nowS)
  return { clock: nyClockTime(time), away: minutes === 'Now' ? minutes : `${minutes} min` }
}

/** What the next-stops list shows: a message alone, or rows (possibly none) under optional notes. */
export type TrainStopsView =
  | { kind: 'message'; text: string }
  | { kind: 'empty'; notes: string[] }
  | { kind: 'rows'; stops: TrainStop[]; notes: string[] }

/**
 * Which state the list is in. `stops` is null until there is a snapshot to read the clock from. Delayed data
 * keeps its times under a note, whether the whole connection is late or just this train's feed.
 */
export function deriveTrainStopsView(status: LiveStatus, stops: TrainStop[] | null, feedStale: boolean): TrainStopsView {
  if (status.kind === 'off') return { kind: 'message', text: 'Live times not available yet' }
  if (status.kind === 'error') return { kind: 'message', text: 'Live times unavailable' }
  if (stops === null) return { kind: 'message', text: 'Connecting to live times' }
  const notes = status.kind === 'stale' || feedStale ? [DELAYED_NOTE] : []
  return stops.length === 0 ? { kind: 'empty', notes } : { kind: 'rows', stops, notes }
}
