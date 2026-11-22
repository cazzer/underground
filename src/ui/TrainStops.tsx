import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ArrivalsSource } from '../lib/live/arrivals'
import { clockNow } from '../lib/live/clock'
import type { LiveStatus } from '../lib/live/liveStatus'
import {
  deriveTrainStopsView,
  isCutShort,
  nextStops,
  stopEta,
  stopEtaSpoken,
  tripTimesDelayed,
  type TrainStop,
} from '../lib/live/trainStops'
import type { Network } from '../lib/network'
import type { LiveTrip } from '../lib/realtime/prepareTrips'
import { useListScroll } from './useListScroll'

/** How often the times are recomputed from the live clock; a new poll updates them sooner. */
const TICK_MS = 15_000
/** Rows shown before "Show next N stops". */
const COLLAPSED_ROWS = 3
const CUT_SHORT_NOTE = 'Times shown up to 30 min ahead'

interface StopRowProps {
  stop: TrainStop
  nowS: number
}

/** One stop: name, clock and minutes in shared columns. The visible times are hidden from screen readers, which get one phrase. */
function StopRow({ stop, nowS }: StopRowProps) {
  const eta = stopEta(stop.time, nowS)
  // A train standing at the stop past its predicted time says only "Now"; one waiting for a time still ahead
  // (a terminal, a held train) shows that time.
  const nowOnly = stop.standing && eta.away === 'Now'
  return (
    <li className="col-span-3 grid grid-cols-subgrid items-baseline py-1.5">
      <span className="min-w-0 leading-tight">{stop.name}</span>
      <span aria-hidden="true" className="text-right font-mono tabular-nums">
        {nowOnly ? '' : `${eta.clock} ·`}
      </span>
      <span aria-hidden="true" className="text-right font-mono tabular-nums">
        {eta.away}
      </span>
      <span className="sr-only">, {stopEtaSpoken(eta)}</span>
    </li>
  )
}

interface ExpandToggleProps {
  expanded: boolean
  total: number
  controls: string
  onToggle: () => void
  /** Called when the button goes away while it has focus. */
  onFocusLost: () => void
}

function ExpandToggle({ expanded, total, controls, onToggle, onFocusLost }: ExpandToggleProps) {
  const button = useRef<HTMLButtonElement>(null)
  // The layout cleanup of an unmounting child runs before React removes its node, so focus can still be read.
  useLayoutEffect(
    () => () => {
      if (button.current !== null && button.current === document.activeElement) onFocusLost()
    },
    [onFocusLost],
  )
  return (
    <button
      ref={button}
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className="-mx-2 mt-1 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      {expanded ? 'Show fewer' : `Show all ${total} stops`}
    </button>
  )
}

interface TrainStopsProps {
  network: Network
  trip: LiveTrip | null
  source: ArrivalsSource | null
  status: LiveStatus
}

/**
 * The selected train's next stops, each with its predicted clock time and minutes away. The clock ticks in
 * here, so a tick re-renders this list and nothing else. The list is not a live region (it would announce
 * every tick); only the state lines are, and that region stays mounted so a change of text is announced.
 */
export function TrainStops({ network, trip, source, status }: TrainStopsProps) {
  const [tick, setTick] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  const focusHeading = useCallback(() => heading.current?.focus({ preventScroll: true }), [])

  // `tick` is not read: it is what makes this recompute against the advancing clock.
  const { nowS, stops, delayed, terminal } = useMemo(() => {
    if (!source || !trip) return { nowS: 0, stops: null, delayed: false, terminal: undefined }
    const now = clockNow(source.offsetS, performance.now())
    return {
      nowS: now,
      stops: nextStops(trip.trip, now, (id) => network.stationById.get(id)?.name),
      delayed: tripTimesDelayed(source.snapshot, trip.feed, source.failures, now),
      terminal: source.lookup.patterns[trip.shapeId]?.stops.at(-1),
    }
  }, [source, trip, network, tick])

  const view = deriveTrainStopsView(status, stops, delayed)
  const stateLines = view.kind === 'message' ? [view.text] : view.notes
  const all = view.kind === 'rows' ? view.stops : []
  const rows = expanded ? all : all.slice(0, COLLAPSED_ROWS)
  const showToggle = all.length > COLLAPSED_ROWS
  // The cut-off note belongs under the last known stop, so only once that row is on screen.
  const cutShort = rows.length === all.length && isCutShort(all, terminal)
  const { scroller, list, capPx, overflows, atEnd, onScroll } = useListScroll(rows.length)
  return (
    <section className="mt-3">
      <h3
        ref={heading}
        id={headingId}
        tabIndex={-1}
        className="text-xs uppercase tracking-widest text-ink-dim outline-none focus-visible:outline-2 focus-visible:outline-focus"
      >
        Next stops
      </h3>
      <div role="status" aria-live="polite">
        {stateLines.map((line) => (
          <p key={line} className="mt-1 text-xs text-ink-dim">
            {line}
          </p>
        ))}
      </div>
      {view.kind === 'empty' && <p className="mt-1 text-sm">No upcoming stops</p>}
      {rows.length > 0 && (
        <div className="relative mt-1">
          {/* On a phone the list is capped at whole rows so the train stays in view above the panel (see
              useListScroll); it is a focusable region only while it actually scrolls. */}
          <div
            ref={scroller}
            onScroll={onScroll}
            style={capPx === null ? undefined : { maxHeight: capPx }}
            {...(overflows ? ({ role: 'region', 'aria-labelledby': headingId, tabIndex: 0 } as const) : {})}
            // `relative` contains the rows' absolutely positioned screen-reader text, which would otherwise
            // escape the scroller's clipping and make the whole panel scroll.
            className="relative overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-focus"
          >
            <ol
              ref={list}
              id={listId}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-2 divide-y divide-edge/30 text-sm"
            >
              {rows.map((stop, i) => (
                <StopRow key={`${stop.stopId}|${i}`} stop={stop} nowS={nowS} />
              ))}
            </ol>
            {cutShort && <p className="mt-1 text-xs text-ink-dim">{CUT_SHORT_NOTE}</p>}
          </div>
          {overflows && !atEnd && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-panel to-transparent" />
          )}
        </div>
      )}
      {showToggle && (
        <ExpandToggle
          expanded={expanded}
          total={all.length}
          controls={listId}
          onToggle={() => setExpanded((e) => !e)}
          onFocusLost={focusHeading}
        />
      )}
    </section>
  )
}
