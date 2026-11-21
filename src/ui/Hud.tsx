import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { useFocus } from '../lib/focus'
import type { Insets } from '../lib/framing'
import type { ScreenRect } from '../lib/interiorCamera'
import { scheduleLabel } from '../lib/labels'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { LiveStatus as LiveStatusValue } from '../lib/live/liveStatus'
import { markedPlacement } from '../lib/locate'
import type { Network } from '../lib/network'
import { useTrainSelection } from '../lib/trainSelection'
import type { LocateControls } from '../data/useLocate'
import { ArrivalsList } from './ArrivalsList'
import { Attribution } from './Attribution'
import { LiveStatus } from './LiveStatus'
import { InteriorStatus, type InteriorStatusInfo } from './InteriorStatus'
import { LocateButton } from './LocateButton'
import { LocateStatus } from './LocateStatus'
import { OrbitHint } from './OrbitHint'
import { RouteChip } from './RouteChip'
import { TrainGonePanel, TrainPanel } from './TrainPanel'

interface ArrivalsPanelProps {
  network: Network
  stationId: string
  live: LiveStatusValue
  arrivals: ArrivalsSource | null
  onClose: () => void
  interior: InteriorStatusInfo
  ref: Ref<HTMLElement>
  /** Takes focus when a panel that covered this one closes. */
  headingRef: Ref<HTMLHeadingElement>
}

function ArrivalsPanel({ network, stationId, live, arrivals, onClose, interior, ref, headingRef }: ArrivalsPanelProps) {
  const station = network.stationById.get(stationId)
  if (!station) throw new Error(`Arrivals panel for unknown station "${stationId}"`)
  return (
    <aside
      ref={ref}
      aria-label={`Arrivals at ${station.name}`}
      className="pointer-events-auto max-h-full min-h-0 w-72 max-w-full overflow-auto border border-edge bg-panel p-4 text-ink backdrop-blur-sm sm:shrink-0"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg leading-tight outline-none">
          {station.name}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close station panel"
          className="-m-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center p-2 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          ×
        </button>
      </div>
      <ul aria-label="Routes" className="mt-1 flex flex-wrap gap-1.5">
        {station.routeIds.map((id) => {
          const route = network.routeById.get(id)
          if (!route) throw new Error(`Station ${station.id} lists unknown route "${id}"`)
          return (
            <RouteChip key={id} route={route} as="li">
              <span className="sr-only">
                {route.shortName}: {route.longName}
              </span>
            </RouteChip>
          )
        })}
      </ul>
      <InteriorStatus info={interior} />
      <OrbitHint />
      <ArrivalsList network={network} station={station} source={arrivals} status={live} />
    </aside>
  )
}

interface HudProps {
  network: Network
  /** Live-trains state, shown under the schedule line. */
  live: LiveStatusValue
  /** What the station panel lists arrivals from. */
  arrivals: ArrivalsSource | null
  /** Reports the screen bands the header and footer cover. */
  onInsets: (insets: Insets) => void
  /** The focused station's interior load and reveal, shown in its panel. */
  interior: InteriorStatusInfo
  /** Reports where the station panel sits (viewport px), or null when it closes. */
  onPanel: (rect: ScreenRect | null) => void
  /** The location button's state and actions. */
  locate: LocateControls
}

export function Hud({ network, live, arrivals, onInsets, interior, onPanel, locate }: HudProps) {
  const { focusedId, dismiss } = useFocus()
  const { selectedSummary, selections, notice, dismissNotice, clearTrain } = useTrainSelection()
  // One value gates the train panel and its Esc: a selection not seen in the feed yet shows no panel.
  const trainOpen = selectedSummary !== null
  const noticeOpen = notice !== null
  const root = useRef<HTMLDivElement>(null)
  const header = useRef<HTMLElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLElement>(null)
  const locateButton = useRef<HTMLButtonElement>(null)
  const stationHeading = useRef<HTMLHeadingElement>(null)
  // Closing the train panel or the notice (× or Esc) hands focus to the station panel's heading when that
  // panel is underneath, else to the location button; the auto-dismissed notice leaves focus alone.
  const [focusReturns, setFocusReturns] = useState(0)
  useEffect(() => {
    if (focusReturns > 0) (stationHeading.current ?? locateButton.current)?.focus({ preventScroll: true })
  }, [focusReturns])
  const closeTrain = useCallback(() => {
    clearTrain()
    setFocusReturns((n) => n + 1)
  }, [clearTrain])
  const closeNotice = useCallback(() => {
    dismissNotice()
    setFocusReturns((n) => n + 1)
  }, [dismissNotice])
  // Clearing removes the × the user just pressed; focus goes back to the button that started it.
  const { clear } = locate
  const onClearLocation = useCallback(() => {
    clear()
    locateButton.current?.focus()
  }, [clear])

  // Measured once, before the scene mounts, for its opening view.
  useLayoutEffect(() => {
    if (!root.current || !header.current || !bottom.current) return
    const r = root.current.getBoundingClientRect()
    onInsets({
      top: header.current.getBoundingClientRect().bottom - r.top,
      bottom: r.bottom - bottom.current.getBoundingClientRect().top,
    })
  }, [onInsets])

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
  }, [focusedId, trainOpen, noticeOpen, onPanel])

  // Esc closes what covers the station panel first (the train panel, then the notice), then the station's.
  useEffect(() => {
    if (!focusedId && !trainOpen && !noticeOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (trainOpen) closeTrain()
      else if (noticeOpen) closeNotice()
      else dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedId, trainOpen, noticeOpen, dismiss, closeTrain, closeNotice])

  return (
    <div ref={root} className="pointer-events-none absolute inset-0 flex flex-col justify-between gap-4 p-4 text-ink">
      <header ref={header} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl tracking-[0.3em] uppercase">underground</h1>
          <p className="text-xs text-ink-dim">{scheduleLabel(network.feedVersion)}</p>
          <LiveStatus status={live} />
          <LocateStatus state={locate.state} onClear={onClearLocation} />
          <p role="status" aria-live="polite" className="sr-only">
            {notice ?? ''}
          </p>
        </div>
        <LocateButton
          ref={locateButton}
          onLocate={locate.locate}
          locating={locate.state.status === 'locating'}
          located={markedPlacement(locate.state) !== null}
        />
      </header>
      {/* DOM order is footer, then panel: matches desktop (left to right); mobile stacks the panel above. */}
      <div ref={bottom} className="flex min-h-0 flex-col-reverse gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <Attribution />
        {selectedSummary ? (
          <TrainPanel network={network} summary={selectedSummary} focusKey={selections} onClose={closeTrain} ref={panel} />
        ) : notice ? (
          <TrainGonePanel notice={notice} onDismiss={closeNotice} ref={panel} />
        ) : focusedId ? (
          <ArrivalsPanel
            network={network}
            stationId={focusedId}
            live={live}
            arrivals={arrivals}
            onClose={dismiss}
            interior={interior}
            ref={panel}
            headingRef={stationHeading}
          />
        ) : null}
      </div>
    </div>
  )
}
