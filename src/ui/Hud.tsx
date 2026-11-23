import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ExitLineView } from '../lib/exitView'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { scheduleLabel } from '../lib/labels'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { OutagePanelView } from '../lib/live/eneText'
import type { LiveStatus as LiveStatusValue } from '../lib/live/liveStatus'
import { markedPlacement } from '../lib/locate'
import { frontPanel } from '../lib/panelCollapseState'
import type { Network } from '../lib/network'
import type { PlacePick } from '../lib/placeLabel'
import { useTrainSelection } from '../lib/trainSelection'
import type { TransferLineView } from '../lib/transferView'
import type { LocateControls } from '../data/useLocate'
import { ArrivalsPanel } from './ArrivalsPanel'
import { Attribution } from './Attribution'
import { FocusAnnouncer } from './FocusAnnouncer'
import { LiveStatus } from './LiveStatus'
import type { InteriorStatusInfo } from './InteriorStatus'
import { LinkNotice } from './LinkNotice'
import { LocateButton } from './LocateButton'
import { LocateStatus } from './LocateStatus'
import { OrbitHint } from './OrbitHint'
import { PlaceStatus } from './PlaceStatus'
import { TrainGonePanel, TrainPanel } from './TrainPanel'
import { SearchButton } from './SearchButton'
import { StationSearch, type StationSearchHandle } from './StationSearch'
import { TripAnnouncer } from './TripAnnouncer'
import { TripPanel } from './TripPanel'
import { usePlaceLine } from './usePlaceLine'
import { useHudInsets } from './useHudInsets'
import { useLineFilter } from './useLineFilter'
import { useTripPanel } from './useTripPanel'

interface HudProps {
  network: Network
  /** Live-trains state, shown under the schedule line. */
  live: LiveStatusValue
  /** What the station panel lists arrivals from. */
  arrivals: ArrivalsSource | null
  /** Reports the screen bands the header and footer cover. */
  onInsets: (insets: Insets) => void
  /** The focused station's interior load, shown in its panel. */
  interior: InteriorStatusInfo
  /** The focused station's out-of-service machines, shown in its panel. */
  outages: OutagePanelView
  /** Reports where the station panel sits (viewport px), or null when it closes. */
  onPanel: (rect: ScreenRect | null) => void
  /** The location button's state and actions. */
  locate: LocateControls
  /** Shown under the location message when a `#station=` link named no station. */
  linkNotice: { show: boolean; onDismiss: () => void }
  /** The trip panel's exit lines, by the trip id of a journey's last ride. */
  tripExits: ReadonlyMap<string, ExitLineView> | null
  /** The trip panel's transfer lines, by change leg key. */
  tripTransfers: ReadonlyMap<string, TransferLineView> | null
  /** The focused station's complex siblings (its group's other members): the trip panel treats them as the focused station. */
  focusSiblings: readonly string[]
  /** Any station's complex siblings (its group's other members): a directions pick never pairs a station with its own complex. */
  siblingsOf: (stationId: string) => readonly string[]
}

export function Hud({ network, live, arrivals, onInsets, interior, outages, onPanel, locate, linkNotice, tripExits, tripTransfers, focusSiblings, siblingsOf }: HudProps) {
  const { focusedId, dismiss, select } = useFocus()
  const lineFilter = useLineFilter(focusedId)
  const { selectedSummary, selectedTrip, selections, notice, dismissNotice, clearTrain, following, follow, unfollow } = useTrainSelection()
  // One value gates the train panel and its Esc: a selection not seen in the feed yet shows no panel.
  const trainOpen = selectedSummary !== null
  const noticeOpen = notice !== null
  const root = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLElement>(null)
  const footer = useRef<HTMLElement>(null)
  const panel = useRef<HTMLElement>(null)
  const locateButton = useRef<HTMLButtonElement>(null)
  const stationHeading = useRef<HTMLElement>(null)
  const tripHeading = useRef<HTMLElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const { tripOpen, openTrip, closeTrip, escapeTrip, focusRequest } = useTripPanel({ locate, panel, stationHeading, searchButton, siblingsOf })
  // The one rule for which panel the bottom slot shows (panelCollapseState.ts); the trip panel stays mounted under a train or notice.
  const front = frontPanel({ trainShown: trainOpen, noticeShown: noticeOpen, tripOpen, focusedId })
  // Closing the train panel or the notice (× or Esc) hands focus to the panel underneath: the trip panel's
  // heading, else the station panel's, else the Search button; the auto-dismissed notice leaves focus alone. It waits one
  // frame so a station panel that auto-focus mounts as the train closes is found and wins; it is read once,
  // so a later auto-focus is not chased.
  const [focusReturns, setFocusReturns] = useState(0)
  useEffect(() => {
    if (focusReturns === 0) return
    const frame = requestAnimationFrame(() => (tripHeading.current ?? stationHeading.current ?? searchButton.current)?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [focusReturns])
  const closeTrain = useCallback(() => {
    clearTrain()
    setFocusReturns((n) => n + 1)
  }, [clearTrain])
  const closeNotice = useCallback(() => {
    dismissNotice()
    setFocusReturns((n) => n + 1)
  }, [dismissNotice])
  // Closing the station panel (Esc) removes the element that had focus; it goes to Search, the way back in.
  const closeStation = useCallback(() => {
    const hadFocus = panel.current?.contains(document.activeElement) ?? false
    dismiss()
    if (hadFocus) searchButton.current?.focus({ preventScroll: true })
  }, [dismiss])
  const search = useRef<StationSearchHandle>(null)
  const place = usePlaceLine()
  // Mirrors the dialog's native open state (set on open and on its close event); the Esc guard reads it.
  const [searchOpen, setSearchOpen] = useState(false)
  // Cancel and Esc leave focus to the dialog, which hands it back to the button that was focused when it
  // opened. A station choice instead moves it to the new station's panel heading, a place choice to the place
  // line, once the dialog has closed; a directions pick hands focus to the trip panel (its own request), not this close event.
  const focusOnClose = useRef<'station' | 'place' | null>(null)
  const openSearch = () => {
    // A tap doesn't focus a button on iOS; the dialog restores focus to whatever had it when it opened.
    searchButton.current?.focus()
    search.current?.open()
    setSearchOpen(true)
  }
  const onSearchClosed = () => {
    setSearchOpen(false)
    const target = focusOnClose.current
    focusOnClose.current = null
    if (target) (target === 'place' ? place.lineRef : stationHeading).current?.focus()
  }
  const onSearchChoose = (stationId: string) => {
    focusOnClose.current = 'station'
    select(stationId)
  }
  const onSearchChoosePlace = (pick: PlacePick) => {
    focusOnClose.current = 'place'
    place.show(pick)
  }
  // Clearing removes the × the user just pressed; focus goes back to the button that started it.
  const { clear } = locate
  const onClearLocation = useCallback(() => {
    clear()
    locateButton.current?.focus()
  }, [clear])

  // Measured before the scene mounts, for its opening view, and again when the header, footer or window resizes.
  useHudInsets({ root, header, footer }, onInsets)

  // Tracked while the panel is open, so a station fly-to can frame the view beside it. Resizes
  // move a stacked (phone) panel's top; window resizes move a desktop panel's left edge.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) {
      onPanel(null)
      return
    }
    // The list inside changes height with every poll; only a real move of the panel reaches the scene.
    let last: ScreenRect | null = null
    const measure = () => {
      const p = el.getBoundingClientRect()
      if (last && last.left === p.left && last.top === p.top && last.right === p.right && last.bottom === p.bottom) return
      last = { left: p.left, top: p.top, right: p.right, bottom: p.bottom }
      onPanel(last)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [focusedId, trainOpen, noticeOpen, tripOpen, onPanel])

  // Esc closes the front panel: the train panel, then the notice, then the trip panel (an opened journey goes back to the list first), then the station's.
  useEffect(() => {
    // While search is open, Esc belongs to it: one press must not also dismiss a panel.
    if ((!focusedId && !trainOpen && !noticeOpen && !tripOpen) || searchOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      // A modal dialog (a trip search, even with focus on the body) owns Esc: its own close is the press.
      if (e.key !== 'Escape' || document.querySelector('dialog:modal')) return
      if (trainOpen) closeTrain()
      else if (noticeOpen) closeNotice()
      else if (tripOpen) escapeTrip()
      else closeStation()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedId, trainOpen, noticeOpen, tripOpen, searchOpen, closeStation, closeTrain, closeNotice, escapeTrip])

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 text-ink">
      <header ref={header} className="relative isolate flex items-start justify-between gap-3">
        {/* Backs the header text so map strokes panned beneath it stay out of the way; no pointer events. */}
        <div aria-hidden className="pointer-events-none absolute -top-4 -right-4 -bottom-6 -left-4 -z-10 bg-linear-to-b from-canvas/85 via-canvas/60 to-transparent" />
        <div className="min-w-0">
          <h1 className="text-xl tracking-[0.2em] uppercase sm:tracking-[0.3em]">underground</h1>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-dim">
            <span>{scheduleLabel(network.feedVersion)}</span>
            <LiveStatus status={live} />
          </p>
          <LocateStatus state={locate.state} onClear={onClearLocation} />
          <PlaceStatus
            ref={place.lineRef}
            place={place.shown}
            onGo={(id) => {
              select(id)
              setFocusReturns((n) => n + 1)
            }}
            onClear={() => {
              place.clear()
              searchButton.current?.focus({ preventScroll: true })
            }}
          />
          <OrbitHint />
          <p role="status" aria-live="polite" className="sr-only">
            {notice ?? ''}
          </p>
          <FocusAnnouncer network={network} covered={trainOpen || noticeOpen || tripOpen} panel={panel} />
          <TripAnnouncer network={network} arrivals={arrivals} covered={trainOpen || noticeOpen} focusSiblings={focusSiblings} />
          <LinkNotice
            show={linkNotice.show}
            onDismiss={linkNotice.onDismiss}
            onSearch={() => {
              linkNotice.onDismiss()
              openSearch()
            }}
          />
        </div>
        <div className="flex shrink-0 gap-2">
          <SearchButton ref={searchButton} onOpen={openSearch} />
          <LocateButton
            ref={locateButton}
            onLocate={locate.locate}
            onClear={onClearLocation}
            locating={locate.state.status === 'locating'}
            located={markedPlacement(locate.state) !== null}
          />
        </div>
      </header>
      {/* DOM order is footer, then panel: matches desktop (left to right); mobile stacks the panel above. */}
      <div className="flex min-h-0 flex-col-reverse gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <Attribution ref={footer} />
        {front === 'train' && selectedSummary && (
          <TrainPanel
            network={network}
            summary={selectedSummary}
            trip={selectedTrip}
            source={arrivals}
            status={live}
            focusKey={selections}
            following={following}
            onFollow={follow}
            onUnfollow={unfollow}
            onClose={closeTrain}
            ref={panel}
          />
        )}
        {front === 'notice' && notice && <TrainGonePanel notice={notice} onDismiss={closeNotice} ref={panel} />}
        {front === 'station' && focusedId && (
          <ArrivalsPanel
            network={network}
            stationId={focusedId}
            live={live}
            arrivals={arrivals}
            interior={interior}
            outages={outages}
            lineFilter={lineFilter}
            onDirections={(end) => openTrip(end, { stationId: focusedId, place: null })}
            ref={panel}
            headingRef={stationHeading}
          />
        )}
        {/* Kept mounted (hidden) under a train panel or notice, so its journeys, scroll and focus survive. */}
        {tripOpen && (
          <TripPanel
            network={network}
            arrivals={arrivals}
            locate={locate}
            headingRef={tripHeading}
            focusRequest={focusRequest}
            onClose={closeTrip}
            covered={trainOpen || noticeOpen}
            exits={tripExits}
            transfers={tripTransfers}
            focusSiblings={focusSiblings}
            ref={trainOpen || noticeOpen ? null : panel}
          />
        )}
      </div>
      <StationSearch ref={search} network={network} fix={markedPlacement(locate.state)} onChoose={onSearchChoose} onChoosePlace={onSearchChoosePlace} onDirections={openTrip} onClose={onSearchClosed} />
    </div>
  )
}
