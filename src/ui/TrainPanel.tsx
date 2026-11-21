import { useEffect, useRef, type Ref } from 'react'
import type { ArrivalsSource } from '../lib/live/arrivals'
import type { LiveStatus } from '../lib/live/liveStatus'
import type { TrainSummary } from '../lib/live/trainSummary'
import type { Network } from '../lib/network'
import type { LiveTrip } from '../lib/realtime/prepareTrips'
import { RouteChip } from './RouteChip'
import { TrainStops } from './TrainStops'

const PANEL =
  'pointer-events-auto max-h-full min-h-0 w-72 max-w-full overflow-auto border border-edge bg-panel p-4 text-ink backdrop-blur-sm sm:shrink-0'

interface CloseButtonProps {
  label: string
  onClick: () => void
}

function CloseButton({ label, onClick }: CloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-m-2 flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center p-2 text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      ×
    </button>
  )
}

interface TrainPanelProps {
  network: Network
  summary: TrainSummary
  /** The selected trip as of the latest poll that had it; its predicted stops are the timetable. */
  trip: LiveTrip | null
  source: ArrivalsSource | null
  status: LiveStatus
  /** Changes on every explicit pick; the heading takes focus each time. */
  focusKey: number
  onClose: () => void
  ref: Ref<HTMLElement>
}

/** The selected train: its route and where it is headed. Sits where the station panel does, over it. */
export function TrainPanel({ network, summary, trip, source, status, focusKey, onClose, ref }: TrainPanelProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  // Two frames late: after a touch tap the browser's compatibility mouse events land on the canvas and would
  // blur a heading focused at once.
  useEffect(() => {
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [focusKey])

  const route = summary.routeId === null ? undefined : network.routeById.get(summary.routeId)
  const name = summary.routeName ? `${summary.routeName} train` : 'Train'
  return (
    <aside ref={ref} aria-label={summary.headsign ? `${name} to ${summary.headsign}` : name} className={PANEL}>
      <div className="flex items-start gap-2">
        {route && <RouteChip route={route} as="span" className="mt-1 min-w-9 shrink-0 text-center" />}
        <h2 ref={heading} tabIndex={-1} className="min-w-0 flex-1 text-lg leading-tight outline-none">
          {route ? <span className="sr-only">{name} </span> : <span>{name} </span>}
          {summary.headsign ? (
            <>
              <span className="text-ink-dim">to</span> {summary.headsign}
            </>
          ) : (
            <span className="text-ink-dim">destination unknown</span>
          )}
        </h2>
        <CloseButton label="Close train panel" onClick={onClose} />
      </div>
      <TrainStops key={trip?.key} network={network} trip={trip} source={source} status={status} />
    </aside>
  )
}

interface TrainGonePanelProps {
  notice: string
  onDismiss: () => void
  ref: Ref<HTMLElement>
}

/** Takes the train panel's place for a while after the selected train drops out of the feed. */
export function TrainGonePanel({ notice, onDismiss, ref }: TrainGonePanelProps) {
  return (
    <aside ref={ref} aria-label="Train no longer tracked" className={PANEL}>
      <div className="flex items-start justify-between gap-3">
        <p className="leading-tight">{notice}</p>
        <CloseButton label="Dismiss" onClick={onDismiss} />
      </div>
    </aside>
  )
}
