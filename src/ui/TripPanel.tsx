import { useCallback, useEffect, useId, useRef, useState, type Ref, type RefObject } from 'react'
import type { LocateControls } from '../data/useLocate'
import { useFocus } from '../lib/focus'
import type { ArrivalsSource } from '../lib/live/arrivals'
import { markedPlacement } from '../lib/locate'
import type { ExitLineView } from '../lib/exitView'
import type { Network } from '../lib/network'
import type { TransferLineView } from '../lib/transferView'
import { useTrainSelection } from '../lib/trainSelection'
import { useTrip } from '../lib/trip'
import { tripBarText } from '../lib/tripBar'
import { planViews, tripMessage, tripNamesOf, tripNowS } from '../lib/tripView'
import { CollapseButton, ExpandBar } from './PanelBar'
import { StationSearch, type StationSearchHandle } from './StationSearch'
import { TripEnds } from './TripEnds'
import { TripJourneys } from './TripJourneys'
import { usePanelToggle } from './usePanelToggle'
import { useScrollHint } from './useScrollHint'

const PANEL =
  'pointer-events-auto min-h-0 w-full max-w-full max-h-[55dvh] overflow-auto border border-edge bg-panel text-ink backdrop-blur-sm sm:max-h-full sm:w-80 sm:shrink-0'

interface TripPanelProps {
  network: Network
  arrivals: ArrivalsSource | null
  locate: LocateControls
  /** A train panel or notice is in front: the panel stays mounted but hidden and inert. */
  covered: boolean
  /** The heading, or the bar while collapsed: takes focus when the panel opens, and when a train panel or notice over it is closed on purpose. */
  headingRef: RefObject<HTMLElement | null>
  /** The exit line of each journey ending on a train, by its last ride's trip id. */
  exits: ReadonlyMap<string, ExitLineView> | null
  /** The transfer line of each change through a hand-authored complex, by its `transferKey`. */
  transfers: ReadonlyMap<string, TransferLineView> | null
  /** The focused station's complex siblings (siblingIdsOf), for the "On the map" row. */
  focusSiblings: readonly string[]
  ref: Ref<HTMLElement>
}

/**
 * Plan a trip: From and To by search, then the journeys leaving now, each marked Live, Live and scheduled, or Scheduled. It sits where the
 * station panel does, in front of it and behind a train panel or notice. What a screen reader hears is the HUD's
 * `TripAnnouncer`; the visible message under the ends is hidden from assistive tech to match.
 */
export function TripPanel({ network, arrivals, locate, covered, headingRef, exits, transfers, focusSiblings, ref }: TripPanelProps) {
  const { ends, plan, showLoading, setEnd, swap, retry } = useTrip()
  const { focusedId, select } = useFocus()
  const { selectTrain } = useTrainSelection()
  const fromSearch = useRef<StationSearchHandle>(null)
  const toSearch = useRef<StationSearchHandle>(null)
  const own = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  const { collapsed, collapse, expand } = usePanelToggle('trip', headingRef)
  const bodyId = useId()
  const setHeading = useCallback((el: HTMLElement | null) => { headingRef.current = el }, [headingRef])
  const retryFrom = useRef<number | null>(null)
  const [retrying, setRetrying] = useState(false)
  const { more, onScroll } = useScrollHint(own, content)
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      own.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [headingRef])

  // Retry stays mounted from the press until its run settles, so focus is never on a button that vanishes: if the
  // run ends without an error the button goes, and focus moves to the heading first.
  useEffect(() => {
    if (!retrying || plan.status === 'loading') return
    // Idle: the ends changed under it, so there is nothing left to retry.
    if (plan.status !== 'idle' && plan.attempt === retryFrom.current) return
    setRetrying(false)
    if (plan.status !== 'error' && document.activeElement === retryButton.current) headingRef.current?.focus({ preventScroll: true })
  }, [retrying, plan, headingRef])

  const names = tripNamesOf(network)
  const views = planViews(plan, tripNowS(arrivals, performance.now(), Date.now()), names)
  const bar = tripBarText(ends, names.station)
  const message = tripMessage(ends, plan, showLoading)
  const placement = markedPlacement(locate.state)
  const loading = plan.status === 'loading'
  return (
    <aside ref={setRef} onScroll={onScroll} aria-label="Trip" hidden={covered} inert={covered} className={`${PANEL} ${collapsed ? '' : 'p-4'}`}>
      <div ref={content}>
        {collapsed ? (
          <ExpandBar ref={setHeading} controls={bodyId} onExpand={expand}>
            <span aria-hidden="true">{bar.text}</span>
            <span className="sr-only">{bar.spoken}</span>
          </ExpandBar>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <h2 ref={setHeading} tabIndex={-1} className="text-lg leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus">
              Trip
            </h2>
            <CollapseButton label="Collapse trip panel" controls={bodyId} onCollapse={collapse} />
          </div>
        )}
        <div id={bodyId} hidden={collapsed}>
          <p className="text-xs text-ink-dim">Leaving now</p>
          <TripEnds
            network={network}
            ends={ends}
            focusedId={focusedId}
            focusSiblings={focusSiblings}
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
          {(plan.status === 'error' || retrying) && (
            <button
              ref={retryButton}
              type="button"
              aria-disabled={loading}
              onClick={() => {
                if (loading) return
                retryFrom.current = plan.status === 'error' ? plan.attempt : null
                setRetrying(true)
                retry()
              }}
              className="-ml-2 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus aria-disabled:cursor-default aria-disabled:no-underline"
            >
              Retry
            </button>
          )}
          <TripJourneys network={network} views={views} onStation={select} drawnKeys={arrivals?.drawnKeys ?? null} onShowTrain={selectTrain} exits={exits} transfers={transfers} />
        </div>
      </div>
      {more && !collapsed && <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -mx-4 -mb-8 h-8 bg-linear-to-t from-panel to-transparent" />}
      <StationSearch ref={fromSearch} network={network} label="Trip from: search stations" placeholder="From station" onChoose={(id) => setEnd('from', id)} />
      <StationSearch ref={toSearch} network={network} label="Trip to: search stations" placeholder="To station" onChoose={(id) => setEnd('to', id)} />
    </aside>
  )
}
