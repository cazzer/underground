import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type RefObject } from 'react'
import { arrivalsAt, formatArrivalTimes, selectableArrival, type ArrivalGroup, type ArrivalsSource } from '../lib/live/arrivals'
import { arrivalGroupCount, arrivalGroupKey, COLLAPSED_ARRIVALS, soonestSections } from '../lib/live/arrivalsCollapse'
import { deriveArrivalsView } from '../lib/live/arrivalsView'
import { clockNow } from '../lib/live/clock'
import { stationFeedHealth } from '../lib/live/feedHealth'
import type { LiveStatus } from '../lib/live/liveStatus'
import { routeSpokenName } from '../lib/labels'
import type { Network, Station } from '../lib/network'
import { useTrainSelection } from '../lib/trainSelection'
import { RouteChip } from './RouteChip'
import { useStackedPanel } from './useStackedPanel'

/** How often the relative times are recomputed from the live clock; a new poll updates them sooner. */
const TICK_MS = 15_000
const NO_KEYS: ReadonlySet<string> = new Set()

// Shared by the rows and the collapsed list's sizer, so the two can't drift apart.
const ROW_BOX = '-mx-1 flex w-[calc(100%+0.5rem)] items-start gap-2 px-1 py-1.5 text-left'
const HEADSIGN = 'block leading-tight'
const TIMES = 'mt-0.5 block font-mono text-sm tabular-nums'
const sectionClass = (i: number) => `divide-y divide-edge/30 text-sm ${i === 0 ? 'mt-1' : 'mt-1.5 border-t border-edge pt-0.5'}`

/**
 * Calls `onFocusLost` if the element still has focus when it unmounts. The layout cleanup of an unmounting child
 * runs before React removes its node, so focus can still be read.
 */
function useFocusLostOnUnmount(el: RefObject<HTMLElement | null>, onFocusLost: () => void): void {
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
function ArrivalRow({ group, network, nowS, drawnKeys, onSelect, onFocusLost }: ArrivalRowProps) {
  const button = useRef<HTMLButtonElement>(null)
  useFocusLostOnUnmount(button, onFocusLost)
  const route = network.routeById.get(group.routeId)
  if (!route) throw new Error(`Arrival for unknown route "${group.routeId}"`)
  const target = selectableArrival(group, drawnKeys)
  return (
    <li data-group={arrivalGroupKey(group)}>
      <button
        ref={button}
        type="button"
        aria-disabled={target === null ? true : undefined}
        aria-description={target === null ? undefined : `Shows the train due in ${formatArrivalTimes([target.time], nowS)}`}
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
        </span>
      </button>
    </li>
  )
}

/**
 * An invisible stand-in for COLLAPSED_ARRIVALS rows whose destinations wrap to two lines, split over both directions:
 * stacked in the same grid cell as the collapsed rows, it holds their height, so a poll that changes which rows are
 * soonest (or how many lines they wrap to) neither grows nor shrinks the panel.
 */
function CollapsedSizer() {
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
function ShowAll({ expanded, controls, total, onToggle, onFocusLost }: ShowAllProps) {
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

interface ArrivalsListProps {
  network: Network
  station: Station
  source: ArrivalsSource | null
  status: LiveStatus
  /** Takes focus when a row or the "Show all" button that has it goes away (a poll, or the panel unstacked). */
  onFocusLost: () => void
}

/** The destination (arrivalGroupKey) of the row holding focus inside the list, from a focus event. */
function focusedGroup(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest('li[data-group]')?.getAttribute('data-group') ?? null) : null
}

/**
 * Next arrivals at one station, a list per direction. The clock ticks in here, so a tick re-renders this list
 * and nothing else. The list is not a live region (it would announce every tick); only the state line is,
 * and not while the header already announces that live data is delayed. A panel stacked over the map (phones in
 * portrait) shows the COLLAPSED_ARRIVALS destinations due soonest, always keeping the focused one, at a fixed height
 * (CollapsedSizer), and "Show all N destinations". Key it by station so a new station starts collapsed.
 */
export function ArrivalsList({ network, station, source, status, onFocusLost }: ArrivalsListProps) {
  const { selectTrain } = useTrainSelection()
  const stacked = useStackedPanel()
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const listId = useId()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])

  // `tick` is not read: it is what makes this recompute against the advancing clock.
  const { nowS, groups, health } = useMemo(() => {
    if (!source) return { nowS: 0, groups: null, health: null }
    const now = clockNow(source.offsetS, performance.now())
    const found = arrivalsAt(source.snapshot, station, now, {
      lookup: source.lookup,
      routeById: network.routeById,
      stationName: (id) => network.stationById.get(id)?.name,
    })
    return { nowS: now, groups: found, health: stationFeedHealth(source.snapshot, station.routeIds, source.failures, now) }
  }, [source, station, network, tick])

  const routeName = (id: string) => network.routeById.get(id)?.shortName ?? id
  const view = deriveArrivalsView(status, groups, health, routeName)
  const stateLines = view.kind === 'message' ? [view.text] : view.notes
  const announce = status.kind !== 'stale' ? ({ role: 'status', 'aria-live': 'polite' } as const) : {}
  const all = view.kind === 'rows' ? view.sections : []
  const total = arrivalGroupCount(all)
  const collapsed = stacked && !expanded && view.kind === 'rows'
  const sections = collapsed ? soonestSections(all, COLLAPSED_ARRIVALS, focused) : all
  const showToggle = stacked && (expanded || total > COLLAPSED_ARRIVALS)
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocused(null)
  }

  return (
    <section className="mt-3 min-h-24">
      <h3 className="sr-only">Arrivals</h3>
      <div {...announce}>
        {stateLines.map((line) => (
          <p key={line} className="mt-1 text-xs text-ink-dim">
            {line}
          </p>
        ))}
      </div>
      {view.kind === 'empty' && <p className="mt-1 text-sm">No upcoming trains</p>}
      <div className="grid">
        {collapsed && <CollapsedSizer />}
        <div id={listId} className="col-start-1 row-start-1" onFocus={(e) => setFocused(focusedGroup(e.target))} onBlur={onBlur}>
          {sections.map((groupsOfDirection, i) => (
            <ul key={groupsOfDirection[0]!.direction} className={sectionClass(i)}>
              {groupsOfDirection.map((g) => (
                <ArrivalRow
                  key={arrivalGroupKey(g)}
                  group={g}
                  network={network}
                  nowS={nowS}
                  drawnKeys={source?.drawnKeys ?? NO_KEYS}
                  onSelect={selectTrain}
                  onFocusLost={onFocusLost}
                />
              ))}
            </ul>
          ))}
        </div>
      </div>
      {showToggle && (
        <ShowAll expanded={expanded} controls={listId} total={total} onToggle={() => setExpanded((e) => !e)} onFocusLost={onFocusLost} />
      )}
    </section>
  )
}
