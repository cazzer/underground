import { useRef } from 'react'
import { useFocusLostOnUnmount } from './ArrivalRows'
import type { Network } from '../lib/network'
import type { JourneyView } from '../lib/tripView'
import { RouteChip } from './RouteChip'
import { JourneyLegs, type JourneyLegsProps } from './TripLegs'
import { useJourneyFocusLost } from './useJourneyFocusLost'

interface JourneyChipsProps {
  network: Network
  view: JourneyView
  className: string
}

/** The routes it rides as chips, then when it leaves and where its times come from. Hidden from assistive tech: `view.spoken` says it. */
export function JourneyChips({ network, view, className }: JourneyChipsProps) {
  return (
    <span aria-hidden="true" className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-dim ${className}`}>
      {view.routes.map((id, i) => {
        const route = network.routeById.get(id)
        return route ? <RouteChip key={i} route={route} as="span" className="min-w-7 text-center" /> : <span key={i}>{id}</span>
      })}
      <span className="whitespace-nowrap">
        {view.departAway === 'Now' ? 'Leaves now' : `Leaves in ${view.departAway}`} · {view.sourceText}
      </span>
      {view.walkNotes.map((note) => (
        <span key={note} className="whitespace-nowrap">
          {note}
        </span>
      ))}
    </span>
  )
}

interface BackButtonProps {
  onBack: () => void
  /** The button went while focused (the plan left one journey, so there is no list): focus moves on. */
  onFocusLost: () => void
}

function BackButton({ onBack, onFocusLost }: BackButtonProps) {
  const button = useRef<HTMLButtonElement>(null)
  useFocusLostOnUnmount(button, onFocusLost)
  return (
    <button
      ref={button}
      type="button"
      data-detail-back
      onClick={onBack}
      aria-label="Back to all trips"
      className="-ml-2 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim underline hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      <span aria-hidden="true">‹ All trips</span>
    </button>
  )
}

interface TripJourneyDetailProps extends JourneyLegsProps {
  /** There is a list to go back to (more than one journey). */
  canGoBack: boolean
  onBack: () => void
  /** The view unmounted while focus was inside it; `journeyKey` is the journey the focus was in. */
  onFocusLost: (journeyKey: string | null) => void
}

/** One journey as its own view: Back (when there is a list), a heading, its summary and its legs. */
export function TripJourneyDetail({ canGoBack, onBack, onFocusLost, ...legs }: TripJourneyDetailProps) {
  const { network, view } = legs
  const root = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  useJourneyFocusLost(root, onFocusLost)
  return (
    <div ref={root} data-journey-key={view.key} className="mt-2">
      {canGoBack && <BackButton onBack={onBack} onFocusLost={() => requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }))} />}
      <h3 ref={heading} tabIndex={-1} data-detail-heading className="text-base outline-none focus-visible:outline-2 focus-visible:outline-focus">
        <span aria-hidden="true">
          {view.departClock} → {view.arriveClock} · {view.minutes} min
        </span>
        <span className="sr-only">{view.spoken}</span>
      </h3>
      <JourneyChips network={network} view={view} className="mb-2 mt-1" />
      <JourneyLegs {...legs} />
    </div>
  )
}
