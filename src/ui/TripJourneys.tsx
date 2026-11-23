import { useCallback, useRef, type RefObject } from 'react'
import type { ExitLineView } from '../lib/exitView'
import type { Network } from '../lib/network'
import type { TransferLineView } from '../lib/transferView'
import { focusAfterViewChange, type TripSelection } from '../lib/tripSelection'
import type { JourneyView } from '../lib/tripView'
import { JourneyChips, TripJourneyDetail } from './TripJourneyDetail'
import { useFocusLostWithin } from './useFocusLostWithin'

interface TripJourneysProps {
  network: Network
  views: readonly JourneyView[]
  /** Which view shows: the list of trips, or one trip's detail. */
  selection: TripSelection
  /** A row was pressed: open that journey (by key) as its own view. */
  onOpen: (key: string) => void
  /** "All trips" was pressed: back to the list. */
  onBack: () => void
  /** The panel's heading: where focus goes when the view that held it is gone and its replacement has no target. */
  panelHeading: RefObject<HTMLElement | null>
  /** A station name was pressed: the one place the trip panel moves the camera. */
  onStation: (stationId: string) => void
  /** The trips the map draws as trains (keyed as a live ride leg's `tripId`); only those can be shown. */
  drawnKeys: ReadonlySet<string> | null
  /** "Show train" was pressed on a live ride leg: selects that train (its panel then covers the trip). */
  onShowTrain: (tripId: string) => void
  /** The way out at the To station, by the trip id of a journey's last ride. */
  exits: ReadonlyMap<string, ExitLineView> | null
  /** The way through a complex at a change, by the change leg's `transferKey`. */
  transfers: ReadonlyMap<string, TransferLineView> | null
}

interface TripListProps {
  network: Network
  views: readonly JourneyView[]
  onOpen: (key: string) => void
  onFocusLost: (journeyKey: string | null) => void
}

/** One collapsed row per journey, soonest arrival first: when it leaves and arrives, how long, changes, lines and where its times come from. */
function TripList({ network, views, onOpen, onFocusLost }: TripListProps) {
  const list = useRef<HTMLOListElement>(null)
  useFocusLostWithin(list, onFocusLost)
  return (
    <ol ref={list} className="mt-2" aria-label="Trips">
      {views.map((view) => (
        <li key={view.key} className="border-t border-edge first:border-t-0">
          <button
            type="button"
            data-journey-key={view.key}
            onClick={() => onOpen(view.key)}
            className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 py-2 text-left hover:text-focus focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span className="flex min-w-0 flex-col items-start gap-1">
              <span aria-hidden="true" className="flex flex-wrap gap-x-2 text-base">
                <span className="whitespace-nowrap">
                  {view.departClock} → {view.arriveClock} ·
                </span>
                <span className="whitespace-nowrap">{view.minutes} min ·</span>
                <span className="whitespace-nowrap">{view.transfersText.toLowerCase()}</span>
              </span>
              <JourneyChips network={network} view={view} className="" />
              <span className="sr-only">{view.spoken}</span>
            </span>
            <span aria-hidden="true" className="shrink-0 text-ink-dim">
              ›
            </span>
          </button>
        </li>
      ))}
    </ol>
  )
}

/**
 * The trip options: a list of collapsed rows, soonest arrival first, where one opens as its own view (its legs and the way
 * out) with a Back button to the list; a plan with one journey opens it directly, with no Back. Focus follows the change: opening
 * focuses the detail's heading, Back its row, and a view that goes while it holds focus (a refresh dropped the journey) hands
 * it to the panel heading.
 */
export function TripJourneys({ network, views, selection, onOpen, onBack, panelHeading, onStation, drawnKeys, onShowTrain, exits, transfers }: TripJourneysProps) {
  const root = useRef<HTMLDivElement>(null)
  const latest = useRef({ view: selection.view, keys: views.map((v) => v.key) })
  latest.current = { view: selection.view, keys: views.map((v) => v.key) }

  // One frame later the new view has mounted. Not connected: the panel itself went (Close trip moves focus on its own).
  const moveFocus = useCallback(
    (leftKey: string | null) => {
      requestAnimationFrame(() => {
        const el = root.current
        if (el === null || !el.isConnected) return
        const target = focusAfterViewChange(latest.current.view, leftKey, latest.current.keys)
        const node =
          target.kind === 'detail'
            ? el.querySelector<HTMLElement>('[data-detail-heading]')
            : target.kind === 'row'
              ? [...el.querySelectorAll<HTMLElement>('button[data-journey-key]')].find((b) => b.dataset.journeyKey === target.key)
              : panelHeading.current
        node?.focus({ preventScroll: true })
      })
    },
    [panelHeading],
  )
  const open = (key: string) => {
    onOpen(key)
    requestAnimationFrame(() => {
      const heading = root.current?.querySelector<HTMLElement>('[data-detail-heading]')
      heading?.focus({ preventScroll: true })
      heading?.closest('[data-journey-key]')?.scrollIntoView({ block: 'nearest' })
    })
  }
  const back = () => {
    onBack()
    moveFocus(selection.openedKey)
  }

  const opened = selection.view === 'detail' ? views.find((v) => v.key === selection.openedKey) : undefined
  return (
    <div ref={root}>
      {selection.view === 'list' && <TripList network={network} views={views} onOpen={open} onFocusLost={moveFocus} />}
      {opened && (
        <TripJourneyDetail
          network={network}
          view={opened}
          canGoBack={selection.canGoBack}
          onBack={back}
          onFocusLost={moveFocus}
          onStation={onStation}
          drawnKeys={drawnKeys}
          onShowTrain={onShowTrain}
          exits={exits}
          transfers={transfers}
        />
      )}
    </div>
  )
}
