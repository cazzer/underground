import { useEffect, useId, useMemo, useState } from 'react'
import type { ArrivalsSource } from '../lib/live/arrivals'
import { clockNow } from '../lib/live/clock'
import type { LiveStatus } from '../lib/live/liveStatus'
import { deriveTrainStopsView, nextStops, stopEta } from '../lib/live/trainStops'
import type { Network } from '../lib/network'
import type { LiveTrip } from '../lib/realtime/prepareTrips'

/** How often the times are recomputed from the live clock; a new poll updates them sooner. */
const TICK_MS = 15_000
/** Rows shown before "Show all". */
const COLLAPSED_ROWS = 3

interface TrainStopsProps {
  network: Network
  trip: LiveTrip | null
  source: ArrivalsSource | null
  status: LiveStatus
}

/**
 * The selected train's next stops, each with its predicted clock time and minutes away. The clock ticks in
 * here, so a tick re-renders this list and nothing else. The list is not a live region (it would announce
 * every tick); only the state line is, and not while the header already announces that live data is delayed.
 */
export function TrainStops({ network, trip, source, status }: TrainStopsProps) {
  const [tick, setTick] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // `tick` is not read: it is what makes this recompute against the advancing clock.
  const { nowS, stops, feedStale } = useMemo(() => {
    if (!source || !trip) return { nowS: 0, stops: null, feedStale: false }
    const now = clockNow(source.offsetS, performance.now())
    return {
      nowS: now,
      stops: nextStops(trip.trip, now, (id) => network.stationById.get(id)?.name),
      feedStale: source.snapshot.feeds[trip.feed].stale,
    }
  }, [source, trip, network, tick])

  const view = deriveTrainStopsView(status, stops, feedStale)
  const stateLines = view.kind === 'message' ? [view.text] : view.notes
  const announce = status.kind !== 'stale' ? ({ role: 'status', 'aria-live': 'polite' } as const) : {}
  const rows = view.kind === 'rows' ? (expanded ? view.stops : view.stops.slice(0, COLLAPSED_ROWS)) : []
  const total = view.kind === 'rows' ? view.stops.length : 0
  return (
    <section className="mt-3">
      <h3 className="text-xs uppercase tracking-widest text-ink-dim">Next stops</h3>
      <div {...announce}>
        {stateLines.map((line) => (
          <p key={line} className="mt-1 text-xs text-ink-dim">
            {line}
          </p>
        ))}
      </div>
      {view.kind === 'empty' && <p className="mt-1 text-sm">No upcoming stops</p>}
      {rows.length > 0 && (
        <ol id={listId} className="mt-1 divide-y divide-edge/30 text-sm">
          {rows.map((stop, i) => {
            const eta = stopEta(stop.time, nowS)
            return (
              <li key={`${stop.stopId}|${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0 flex-1 leading-tight">{stop.name}</span>
                <span className="shrink-0 font-mono tabular-nums">
                  {eta.clock}
                  <span aria-hidden="true"> · </span>
                  {eta.away}
                </span>
              </li>
            )
          })}
        </ol>
      )}
      {total > COLLAPSED_ROWS && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((e) => !e)}
          className="-mx-2 mt-1 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          {expanded ? 'Show fewer' : `Show all ${total} stops`}
        </button>
      )}
    </section>
  )
}
