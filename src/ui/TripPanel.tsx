import { useEffect, useRef, useState, type RefObject, type Ref } from 'react'
import type { LocateControls } from '../data/useLocate'
import { useFocus } from '../lib/focus'
import type { ArrivalsSource } from '../lib/live/arrivals'
import { markedPlacement } from '../lib/locate'
import type { Network } from '../lib/network'
import { useTrip } from '../lib/trip'
import {
  journeyView,
  shouldAnnounceTrip,
  tripAnnounceId,
  tripAnnouncement,
  tripMessage,
  tripNowS,
  type TripNames,
} from '../lib/tripView'
import { StationSearch, type StationSearchHandle } from './StationSearch'
import { TripEnds } from './TripEnds'
import { TripJourneys } from './TripJourneys'

const PANEL =
  'pointer-events-auto min-h-0 w-full max-w-full max-h-[55dvh] overflow-auto border border-edge bg-panel p-4 text-ink backdrop-blur-sm sm:max-h-full sm:w-80 sm:shrink-0'

interface TripPanelProps {
  network: Network
  arrivals: ArrivalsSource | null
  locate: LocateControls
  onClose: () => void
  /** Takes focus when the panel mounts, and when a panel over it closes. */
  headingRef: RefObject<HTMLHeadingElement | null>
  ref: Ref<HTMLElement>
}

/**
 * Plan a trip: From and To by search, then the journeys leaving now, each marked Scheduled. It sits where the
 * station panel does, in front of it and behind a train panel or notice. One always-mounted polite live region
 * speaks a settled plan once; the visible message under the ends is hidden from assistive tech to match.
 */
export function TripPanel({ network, arrivals, locate, onClose, headingRef, ref }: TripPanelProps) {
  const { ends, plan, showLoading, setEnd, swap, retry } = useTrip()
  const { focusedId, select } = useFocus()
  const fromSearch = useRef<StationSearchHandle>(null)
  const toSearch = useRef<StationSearchHandle>(null)
  const [spoken, setSpoken] = useState('')
  const lastAnnounced = useRef<string | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [headingRef])

  const names: TripNames = {
    station: (id) => network.stationById.get(id)?.name ?? id,
    route: (id) => network.routeById.get(id)?.shortName ?? id,
  }
  const nowS = tripNowS(arrivals, performance.now(), Date.now())
  const views = plan.status === 'ready' ? plan.journeys.map((j) => journeyView(j, nowS, names)) : []
  const message = tripMessage(ends, plan, showLoading)

  useEffect(() => {
    if (!shouldAnnounceTrip(plan, lastAnnounced.current)) return
    lastAnnounced.current = tripAnnounceId(plan)
    setSpoken(tripAnnouncement(ends, plan, views))
    // `ends` and `views` are what `plan` answers; the plan is the trigger.
  }, [plan])

  const placement = markedPlacement(locate.state)
  return (
    <aside ref={ref} aria-label="Trip" className={PANEL}>
      <div className="flex items-start justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus">
          Trip
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close trip panel"
          className="-m-2 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center p-2 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          ×
        </button>
      </div>
      <p className="text-xs text-ink-dim">Leaving now</p>
      <TripEnds
        network={network}
        ends={ends}
        focusedId={focusedId}
        nearestId={placement?.nearest.id ?? null}
        onPick={(end) => (end === 'from' ? fromSearch : toSearch).current?.open()}
        onSet={setEnd}
        onSwap={swap}
      />
      {message !== null && (
        <p aria-hidden="true" className="mt-2 text-sm text-ink-dim">
          {message}
        </p>
      )}
      {plan.status === 'error' && (
        <button
          type="button"
          onClick={retry}
          className="-ml-2 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          Retry
        </button>
      )}
      <TripJourneys network={network} views={views} onStation={select} />
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {spoken}
      </p>
      <StationSearch ref={fromSearch} network={network} label="Trip from: search stations" placeholder="From station" onChoose={(id) => setEnd('from', id)} />
      <StationSearch ref={toSearch} network={network} label="Trip to: search stations" placeholder="To station" onChoose={(id) => setEnd('to', id)} />
    </aside>
  )
}
