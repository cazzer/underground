import { useCallback, useEffect, useRef, useState } from 'react'
import { FEATURES } from '../config'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { scheduleLabel } from '../lib/labels'
import type { AlertSkips } from '../lib/live/alertSkips'
import { alertChip, type AlertListBody } from '../lib/live/alertList'
import type { ServiceChangeView } from '../lib/live/alertText'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { OutagePanelView } from '../lib/live/eneText'
import type { LiveStatus as LiveStatusValue } from '../lib/live/liveStatus'
import { markedPlacement } from '../lib/locate'
import { usePanelCollapse } from '../lib/panelCollapse'
import type { Network } from '../lib/network'
import type { PlacePick } from '../lib/placeLabel'
import { useTrainSelection } from '../lib/trainSelection'
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
import { ServiceChangesChip } from './ServiceChangesChip'
import { SERVICE_CHANGES_PANEL_ID, ServiceChangesPanel } from './ServiceChangesPanel'
import { TrainGonePanel, TrainPanel } from './TrainPanel'
import { SearchButton } from './SearchButton'
import { StationSearch, type StationSearchHandle } from './StationSearch'
import { TripAnnouncer } from './TripAnnouncer'
import { TripPanel, type TripLines } from './TripPanel'
import type { PlaceLine } from './usePlaceLine'
import { useHudInsets } from './useHudInsets'
import { useChangesPanel } from './useChangesPanel'
import { useLineFilter } from './useLineFilter'
import { usePanelEscape } from './usePanelEscape'
import { usePanelReport } from './usePanelReport'
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
  /** The focused station's service changes (MTA alerts), shown in its panel. */
  changes: ServiceChangeView
  /** The MTA's skip alerts, for the train panel's stops and the arrivals rows. */
  skips: AlertSkips | null
  /** Every service change in effect or coming within a day: the header chip and its list panel. */
  changeList: AlertListBody
  /** Reports where the station panel sits (viewport px), or null when it closes. */
  onPanel: (rect: ScreenRect | null) => void
  /** The location button's state and actions. */
  locate: LocateControls
  /** The picked place's line state (App owns it: the scene draws its pin). */
  place: PlaceLine
  /** Shown under the location message when a `#station=` link named no station. */
  linkNotice: { show: boolean; onDismiss: () => void }
  /** The trip panel's exit and transfer lines and the station index its steps read. */
  tripLines: TripLines
  /** The focused station's complex siblings (its group's other members): the trip panel treats them as the focused station. */
  focusSiblings: readonly string[]
  /** Any station's complex siblings (its group's other members): a directions pick never pairs a station with its own complex. */
  siblingsOf: (stationId: string) => readonly string[]
}

export function Hud({ network, live, arrivals, onInsets, interior, outages, changes, skips, changeList, onPanel, locate, place, linkNotice, tripLines, focusSiblings, siblingsOf }: HudProps) {
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
  const chipButton = useRef<HTMLButtonElement>(null)
  const { tripOpen, openTrip, closeTrip, escapeTrip, focusRequest } = useTripPanel({ locate, panel, stationHeading, searchButton, siblingsOf })
  const { changesOpen, headingRef: changesHeading, toggleChanges, closeChanges, chipFocusLost } = useChangesPanel({ panel, chipRef: chipButton, tripHeading, stationHeading, searchButton })
  // The one rule for which panel the bottom slot shows (panelCollapseState.ts); the changes and trip panels stay mounted under a train or notice.
  const { front } = usePanelCollapse()
  const chip = alertChip(changeList, changesOpen)
  // Closing the train panel or the notice (× or Esc) hands focus to the panel underneath: the changes list's heading, else the
  // trip panel's, else the station panel's, else the Search button; the auto-dismissed notice leaves focus alone. It waits one frame so a station
  // panel that auto-focus mounts as the train closes is found and wins; it is read once, so a later auto-focus is not chased.
  const [focusReturns, setFocusReturns] = useState(0)
  useEffect(() => {
    if (focusReturns === 0) return
    const frame = requestAnimationFrame(() => (changesHeading.current ?? tripHeading.current ?? stationHeading.current ?? searchButton.current)?.focus({ preventScroll: true }))
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
  // Mirrors the dialog's native open state (set on open and on its close event); the Esc guard reads it.
  const [searchOpen, setSearchOpen] = useState(false)
  // Cancel and Esc leave focus to the dialog, which hands it back to the button that was focused when it
  // opened. A station choice instead moves it to the new station's panel heading, a place choice to the place
  // line, once the dialog has closed; a directions pick hands focus to the trip panel (its own request), not this close event.
  const focusOnClose = useRef<'station' | 'place' | 'locate' | null>(null)
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
    if (target) (target === 'place' ? place.lineRef : target === 'locate' ? locateButton : stationHeading).current?.focus()
  }
  const onSearchChoose = (stationId: string) => {
    focusOnClose.current = 'station'
    // A search pick asks for that station, so the list doesn't hide its panel (a map tap keeps the list open).
    if (changesOpen) closeChanges()
    select(stationId)
  }
  const onSearchChoosePlace = (pick: PlacePick) => {
    focusOnClose.current = 'place'
    place.show(pick)
  }
  // The dialog's "My location" row flies where the header button does; focus ends on that button.
  const onSearchChooseHere = () => {
    focusOnClose.current = 'locate'
    locate.showFix()
  }
  // Clearing removes the × the user just pressed; focus goes back to the button that started it.
  const { clear } = locate
  const onClearLocation = useCallback(() => {
    clear()
    locateButton.current?.focus()
  }, [clear])

  // Measured before the scene mounts, for its opening view, and again when the header, footer or window resizes.
  useHudInsets({ root, header, footer }, onInsets)

  usePanelReport({ panel, onPanel, focusedId, trainOpen, noticeOpen, changesOpen, tripOpen })
  usePanelEscape({ front, searchOpen, closeTrain, closeNotice, closeChanges, escapeTrip, closeStation })

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
          <ServiceChangesChip ref={chipButton} chip={chip} expanded={front === 'changes'} controls={SERVICE_CHANGES_PANEL_ID} onToggle={toggleChanges} onFocusLost={chipFocusLost} />
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
          <FocusAnnouncer network={network} covered={trainOpen || noticeOpen || changesOpen || tripOpen} panel={panel} skipSpoken={changes.skipSpoken} />
          {FEATURES.navigation && <TripAnnouncer network={network} arrivals={arrivals} covered={trainOpen || noticeOpen || changesOpen} focusSiblings={focusSiblings} />}
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
            skips={skips}
            ref={panel}
          />
        )}
        {front === 'notice' && notice && <TrainGonePanel notice={notice} onDismiss={closeNotice} ref={panel} />}
        {/* Kept mounted (hidden) under a train panel or notice, so its scroll and collapse survive. */}
        {changesOpen && (
          <ServiceChangesPanel
            body={changeList}
            chip={chip}
            routeById={network.routeById}
            covered={front !== 'changes'}
            headingRef={changesHeading}
            onClose={closeChanges}
            ref={front === 'changes' ? panel : null}
          />
        )}
        {front === 'station' && focusedId && (
          <ArrivalsPanel
            network={network}
            stationId={focusedId}
            live={live}
            arrivals={arrivals}
            interior={interior}
            outages={outages}
            changes={changes}
            skips={skips}
            lineFilter={lineFilter}
            onDirections={FEATURES.navigation ? (end) => openTrip(end, { stationId: focusedId, place: null }) : undefined}
            ref={panel}
            headingRef={stationHeading}
          />
        )}
        {/* Kept mounted (hidden) under a train panel, notice or the changes list, so its journeys, scroll and focus survive. */}
        {tripOpen && (
          <TripPanel
            network={network}
            arrivals={arrivals}
            locate={locate}
            headingRef={tripHeading}
            focusRequest={focusRequest}
            onClose={closeTrip}
            covered={front !== 'trip'}
            lines={tripLines}
            focusSiblings={focusSiblings}
            ref={front === 'trip' ? panel : null}
          />
        )}
      </div>
      <StationSearch
        ref={search}
        network={network}
        locate={locate}
        onChoose={onSearchChoose}
        onChoosePlace={onSearchChoosePlace}
        onChooseHere={onSearchChooseHere}
        onDirections={FEATURES.navigation ? openTrip : undefined}
        onClose={onSearchClosed}
      />
    </div>
  )
}
