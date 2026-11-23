import { useLayoutEffect, useRef, type RefObject } from 'react'
import { arrivalSkipNote, type SkipMark } from '../lib/live/alertSkips'
import { formatArrivalTimes, selectableArrival, type ArrivalGroup } from '../lib/live/arrivals'
import { arrivalGroupKey, COLLAPSED_ARRIVALS } from '../lib/live/arrivalsCollapse'
import { routeSpokenName } from '../lib/labels'
import type { Network } from '../lib/network'
import { RouteChip } from './RouteChip'

// Shared by the rows and the collapsed list's sizer, so the two can't drift apart.
const ROW_BOX = '-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2 px-1 py-1.5 text-left'
const HEADSIGN = 'block leading-tight'
const TIMES = 'mt-0.5 block font-mono text-sm tabular-nums'
const NOTE = 'mt-0.5 block text-xs text-ink-dim'
const shownTrainText = (when: string): string => (when === 'Now' ? 'Shows the train arriving now' : `Shows the train due in ${when}`)
export const sectionClass = (i: number) => `divide-y divide-edge/30 text-sm ${i === 0 ? 'mt-1' : 'mt-1.5 border-t border-edge pt-0.5'}`

/**
 * Calls `onFocusLost` if the element still has focus when it unmounts. The layout cleanup of an unmounting child
 * runs before React removes its node, so focus can still be read.
 */
export function useFocusLostOnUnmount(el: RefObject<HTMLElement | null>, onFocusLost: () => void): void {
  const lost = useRef(onFocusLost)
  useLayoutEffect(() => {
    lost.current = onFocusLost
  })
  useLayoutEffect(
    () => () => {
      if (el.current !== null && el.current === document.activeElement) lost.current()
    },
    [el],
  )
}

interface ArrivalRowProps {
  group: ArrivalGroup
  network: Network
  nowS: number
  drawnKeys: ReadonlySet<string>
  /** The MTA's notice says this route and direction skip the station: the predicted row stays, under a dim note. */
  skip: SkipMark | null
  onSelect: (tripKey: string) => void
  /** Called when the row goes away while it has focus (its destination left the list). */
  onFocusLost: () => void
}

/**
 * One route, direction and destination. The row is always a button, so a poll that changes which trains are
 * drawn never drops focus. When the map draws one of its trains it selects the soonest such train (the camera
 * then follows it and its panel takes focus) and its description says which arrival that is (the soonest listed
 * train is not drawn when it has not left its terminal yet); otherwise it is aria-disabled, a no-op that looks
 * like text.
 */
export function ArrivalRow({ group, network, nowS, drawnKeys, skip, onSelect, onFocusLost }: ArrivalRowProps) {
  const button = useRef<HTMLButtonElement>(null)
  useFocusLostOnUnmount(button, onFocusLost)
  const route = network.routeById.get(group.routeId)
  if (!route) throw new Error(`Arrival for unknown route "${group.routeId}"`)
  const target = selectableArrival(group, drawnKeys)
  const note = skip === null ? null : arrivalSkipNote(skip)
  return (
    <li data-group={arrivalGroupKey(group)}>
      <button
        ref={button}
        type="button"
        aria-disabled={target === null ? true : undefined}
        aria-description={target === null ? undefined : shownTrainText(formatArrivalTimes([target.time], nowS))}
        onClick={target === null ? undefined : () => onSelect(target.tripKey)}
        className={`${ROW_BOX} focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus ${
          target === null ? 'cursor-default' : 'cursor-pointer hover:bg-edge/20'
        }`}
      >
        {/* The sr-only "L train" below names the route; the chip's tooltip (its long name) would only repeat it in the button's name. */}
        <span aria-hidden="true" className="mt-px flex shrink-0">
          <RouteChip route={route} as="span" className="min-w-9 text-center" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={HEADSIGN}>
            <span className="sr-only">{routeSpokenName(route.shortName)} train </span>
            <span className="text-ink-dim">to</span> {group.headsign}
          </span>
          <span className={TIMES}>{formatArrivalTimes(group.times, nowS)}</span>
          {note !== null && (
            <>
              <span className="sr-only">, {note}</span>
              <span aria-hidden="true" className={NOTE}>
                {note}
              </span>
            </>
          )}
        </span>
      </button>
    </li>
  )
}

interface CollapsedSizerProps {
  /** Some route here skips the station: reserve a note line. */
  note: boolean
}

/**
 * An invisible stand-in for COLLAPSED_ARRIVALS rows whose destinations wrap to two lines, split over both directions:
 * stacked in the same grid cell as the collapsed rows, it holds their height, so a poll that changes which rows are
 * soonest (or how many lines they wrap to) neither grows nor shrinks the panel. With `note` one row also holds a
 * skip note's line.
 */
export function CollapsedSizer({ note }: CollapsedSizerProps) {
  return (
    <div aria-hidden="true" inert className="invisible col-start-1 row-start-1">
      {[COLLAPSED_ARRIVALS - 1, 1].map((rows, i) => (
        <ul key={i} className={sectionClass(i)}>
          {Array.from({ length: rows }, (_, j) => (
            <li key={j}>
              <div className={ROW_BOX}>
                <span className="min-w-0 flex-1">
                  <span className={HEADSIGN}>
                    M<br />M
                  </span>
                  <span className={TIMES}>M</span>
                  {note && i === 0 && j === 0 && <span className={NOTE}>M</span>}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}

interface ShowAllProps {
  expanded: boolean
  controls: string
  total: number
  onToggle: () => void
  /** Called when the button goes away while it has focus. */
  onFocusLost: () => void
}

/** "Show all N destinations" / "Show fewer": one button, so toggling keeps focus (like OutageStatus's). */
export function ShowAll({ expanded, controls, total, onToggle, onFocusLost }: ShowAllProps) {
  const button = useRef<HTMLButtonElement>(null)
  useFocusLostOnUnmount(button, onFocusLost)
  return (
    <button
      ref={button}
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className="-mx-2 mt-1 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
    >
      {expanded ? 'Show fewer' : `Show all ${total} destinations`}
    </button>
  )
}
