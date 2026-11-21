/** Consecutive polls without the selected trip after which the selection clears. One miss is a feed hiccup. */
export const MISSES_TO_CLEAR = 2

/**
 * The selected train, by trip key. `T` is a trip and `S` what is said about it (route, headsign); the summary
 * is taken whenever the trip is seen, so the notice can still name it after the trip and its data are gone.
 */
export interface TrainSelectionState<T extends { key: string }, S> {
  key: string | null
  /** Consecutive observed polls the selected trip was missing from. */
  missed: number
  /** The selected trip as last seen (kept through a one-poll miss), and its summary; null if never seen. */
  lastTrip: T | null
  lastSummary: S | null
  /** The last trips array observed, so a repeat (StrictMode re-running an effect) counts once. */
  observed: readonly T[] | null
  /** Set when a selection is lost to the feed, with the trip's last summary (null if it was never seen). */
  notice: { summary: S | null } | null
  /** Counts explicit selections, so the panel can take focus on each one. */
  selections: number
}

export type TrainSelectionEvent<T extends { key: string }, S> =
  | { type: 'select'; key: string; summarize: (trip: T) => S }
  | { type: 'clear' }
  | { type: 'dismissNotice' }
  | { type: 'observe'; trips: readonly T[] | null; summarize: (trip: T) => S }

export function initialTrainSelection<T extends { key: string }, S>(): TrainSelectionState<T, S> {
  return { key: null, missed: 0, lastTrip: null, lastSummary: null, observed: null, notice: null, selections: 0 }
}

function lost<T extends { key: string }, S>(s: TrainSelectionState<T, S>, observed: readonly T[] | null): TrainSelectionState<T, S> {
  return { ...s, key: null, missed: 0, lastTrip: null, lastSummary: null, observed, notice: { summary: s.lastSummary } }
}

/**
 * Selection across polls: a present trip resets the miss count, MISSES_TO_CLEAR misses in a row clear the
 * selection with a notice. Losing the live layer altogether (null trips) keeps the selection and resets the
 * count, so an outage never blames the train. A user clear is silent.
 */
export function trainSelectionReducer<T extends { key: string }, S>(
  s: TrainSelectionState<T, S>,
  e: TrainSelectionEvent<T, S>,
): TrainSelectionState<T, S> {
  switch (e.type) {
    case 'select': {
      const trip = s.observed?.find((t) => t.key === e.key) ?? null
      return {
        ...s,
        key: e.key,
        missed: 0,
        lastTrip: trip,
        lastSummary: trip ? e.summarize(trip) : null,
        notice: null,
        selections: s.selections + 1,
      }
    }
    case 'clear':
      return s.key === null && s.notice === null ? s : { ...s, key: null, missed: 0, lastTrip: null, lastSummary: null, notice: null }
    case 'dismissNotice':
      return s.notice === null ? s : { ...s, notice: null }
    case 'observe': {
      if (e.trips === s.observed) return s
      if (s.key === null) return { ...s, observed: e.trips }
      // No live layer is an outage (the feed failed past its cutoff, or the layer crashed), not a train that
      // left: the selection stays, with its last trip, and the panel says the times are unavailable. The miss
      // count pauses (it is neither added to nor reset), so flapping between a layer and none cannot hide a
      // train that is really gone.
      if (e.trips === null) return { ...s, observed: null }
      const trip = e.trips.find((t) => t.key === s.key)
      if (trip) return { ...s, missed: 0, lastTrip: trip, lastSummary: e.summarize(trip), observed: e.trips }
      if (s.missed + 1 >= MISSES_TO_CLEAR) return lost(s, e.trips)
      return { ...s, missed: s.missed + 1, observed: e.trips }
    }
  }
}
