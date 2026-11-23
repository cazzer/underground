import { useCallback, useEffect, useId, useRef, useState, type Ref, type RefObject } from 'react'
import { layoutOf, type IndexLoad } from '../data/interiorLoad'
import { GEOCODE_URL } from '../data/realtime'
import type { LocateControls } from '../data/useLocate'
import { useFocus } from '../lib/focus'
import type { ArrivalsSource } from '../lib/live/arrivals'
import { markedPlacement } from '../lib/locate'
import type { ExitLineView } from '../lib/exitView'
import { nearNote } from '../lib/placeLabel'
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
import type { TripFocusRequest } from './useTripPanel'

const PANEL =
  'pointer-events-auto min-h-0 w-full max-w-full max-h-[55dvh] overflow-auto border border-edge bg-panel text-ink backdrop-blur-sm sm:max-h-full sm:w-80 sm:shrink-0'

/** What the trip panel draws beside the steps of the opened journey: the way out, the changes' ways, the station index and the way to the first platform. */
export interface TripLines {
  /** The exit line of each journey ending on a train, by its last ride's trip id. */
  exits: ReadonlyMap<string, ExitLineView> | null
  /** The transfer line of each change through a hand-authored complex, by its `transferKey`. */
  transfers: ReadonlyMap<string, TransferLineView> | null
  /** Which stations have an interior: a step at one without says "No station layout". */
  index: IndexLoad
  /** The way in at the From station of each journey that boards its first train there, by `boardLineKey` of that ride. */
  boards: ReadonlyMap<string, ExitLineView> | null
}

interface TripPanelProps {
  network: Network
  arrivals: ArrivalsSource | null
  locate: LocateControls
  /** A train panel or notice is in front: the panel stays mounted but hidden and inert. */
  covered: boolean
  /** The heading, or the bar while collapsed: takes focus on a directions pick that fills both ends, and when a train panel or notice over it is closed on purpose. */
  headingRef: RefObject<HTMLElement | null>
  /** The latest directions pick's focus target: the heading, or the row of the end it left empty. */
  focusRequest: TripFocusRequest | null
  /** "Close trip". */
  onClose: () => void
  lines: TripLines
  /** The focused station's complex siblings (its group's other members), for the "On the map" row. */
  focusSiblings: readonly string[]
  ref: Ref<HTMLElement>
}

/**
 * Plan a trip: From and To by search, then the journeys leaving now as collapsed rows (each marked Live, Live and scheduled, or Scheduled), one of which opens as its own view with Back. A directions
 * pick opens it (a search row's From or To, the station panel's); "Close trip" or Esc closes it. It sits where the
 * station panel does, in front of it and behind a train panel or notice. What a screen reader hears is the HUD's
 * `TripAnnouncer`; the visible message under the ends is hidden from assistive tech to match.
 */
export function TripPanel({ network, arrivals, locate, covered, headingRef, focusRequest, onClose, lines, focusSiblings, ref }: TripPanelProps) {
  const { ends, places, plan, showLoading, setEnd, swap, retry, selection, openJourney, backToList, dropNoteShown, activeStep, stepTo } = useTrip()
  const { focusedId } = useFocus()
  const { selectTrain } = useTrainSelection()
  const fromSearch = useRef<StationSearchHandle>(null)
  const toSearch = useRef<StationSearchHandle>(null)
  const own = useRef<HTMLElement | null>(null)
  const content = useRef<HTMLDivElement>(null)
  const retryButton = useRef<HTMLButtonElement>(null)
  const rows = { from: useRef<HTMLButtonElement>(null), to: useRef<HTMLButtonElement>(null) }
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

  // Every directions pick (the panel only ever mounts through one) says where focus goes: the heading, or the empty end's row.
  const { from: fromRow, to: toRow } = rows
  useEffect(() => {
    if (!focusRequest) return
    const frame = requestAnimationFrame(() => {
      const el = focusRequest.target === 'heading' ? headingRef.current : (focusRequest.target === 'from' ? fromRow : toRow).current
      el?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusRequest, headingRef, fromRow, toRow])

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
  const bar = tripBarText(ends, (id) => network.groupById.get(id)?.name ?? id)
  const message = tripMessage(ends, plan, showLoading)
  const placement = markedPlacement(locate.state)
  const loading = plan.status === 'loading'
  return (
    <aside ref={setRef} onScroll={onScroll} aria-label="Trip" hidden={covered} inert={covered} className={`${PANEL} ${collapsed ? '' : 'p-4'}`}>
      <div ref={content}>
        {collapsed ? (
          <ExpandBar ref={setHeading} label={bar.spoken} controls={bodyId} onExpand={expand}>
            <span aria-hidden="true" className="line-clamp-2 min-w-0">
              {bar.text}
            </span>
          </ExpandBar>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <h2 ref={setHeading} tabIndex={-1} className="text-lg leading-tight outline-none focus-visible:outline-2 focus-visible:outline-focus">
              Trip
            </h2>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="-my-2 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
              >
                Close trip
              </button>
              <CollapseButton label="Collapse trip panel" controls={bodyId} onCollapse={collapse} />
            </div>
          </div>
        )}
        <div id={bodyId} hidden={collapsed}>
          <p className="text-xs text-ink-dim">Leaving now</p>
          <TripEnds
            network={network}
            ends={ends}
            places={places}
            focusedId={focusedId}
            focusSiblings={focusSiblings}
            nearestId={placement?.nearest.id ?? null}
            rows={rows}
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
          {dropNoteShown && (
            <p aria-hidden="true" className="mt-2 text-sm text-ink-dim">
              The trip you opened is no longer offered.
            </p>
          )}
          <TripJourneys
            network={network}
            views={views}
            selection={selection}
            onOpen={openJourney}
            onBack={backToList}
            panelHeading={headingRef}
            legs={{
              drawnKeys: arrivals?.drawnKeys ?? null,
              onShowTrain: selectTrain,
              exits: lines.exits,
              transfers: lines.transfers,
              layoutOf: (id) => layoutOf(id, lines.index),
              boards: lines.boards,
              activeStep,
              onStep: stepTo,
            }}
          />
        </div>
      </div>
      {more && !collapsed && <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -mx-4 -mb-8 h-8 bg-linear-to-t from-panel to-transparent" />}
      {/* A place picked here sets the end to its nearest station and flies nowhere, like a station picked here. */}
      <StationSearch
        ref={fromSearch}
        network={network}
        fix={placement}
        label={GEOCODE_URL ? 'Trip from: search stations and places' : 'Trip from: search stations'}
        placeholder={GEOCODE_URL ? 'From station or address' : 'From station'}
        onChoose={(id) => setEnd('from', id)}
        onChoosePlace={(p) => setEnd('from', p.nearest.id, nearNote(p))}
      />
      <StationSearch
        ref={toSearch}
        network={network}
        fix={placement}
        label={GEOCODE_URL ? 'Trip to: search stations and places' : 'Trip to: search stations'}
        placeholder={GEOCODE_URL ? 'To station or address' : 'To station'}
        onChoose={(id) => setEnd('to', id)}
        onChoosePlace={(p) => setEnd('to', p.nearest.id, nearNote(p))}
      />
    </aside>
  )
}
