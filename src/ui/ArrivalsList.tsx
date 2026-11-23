import { useEffect, useId, useMemo, useRef, useState, type FocusEvent } from 'react'
import { skipAt, stationHasSkip, type AlertSkips } from '../lib/live/alertSkips'
import { arrivalsAt, type ArrivalsSource } from '../lib/live/arrivals'
import { arrivalGroupCount, arrivalGroupKey, COLLAPSED_ARRIVALS, soonestSections } from '../lib/live/arrivalsCollapse'
import { deriveArrivalsView } from '../lib/live/arrivalsView'
import { clockNow } from '../lib/live/clock'
import { stationFeedHealth } from '../lib/live/feedHealth'
import { filterArrivals, lineFilterAnnouncement, lineKey, linesDue, stationLines, type LineChoice } from '../lib/live/lineFilter'
import type { LiveStatus } from '../lib/live/liveStatus'
import { routeSpokenName } from '../lib/labels'
import type { Network } from '../lib/network'
import type { StationGroup } from '../lib/stationGroups'
import { useTrainSelection } from '../lib/trainSelection'
import { ArrivalRow, CollapsedSizer, sectionClass, ShowAll } from './ArrivalRows'
import { LineFilter } from './LineFilter'
import type { LineFilterControl } from './useLineFilter'
import { useListScroll } from './useListScroll'
import { useStackedPanel } from './useStackedPanel'

/** How often the relative times are recomputed from the live clock; a new poll updates them sooner. */
const TICK_MS = 15_000
/** How long the filter's spoken line stays before it is emptied. */
const ANNOUNCE_CLEAR_MS = 6_000
const NO_KEYS: ReadonlySet<string> = new Set()

interface ArrivalsListProps {
  network: Network
  station: StationGroup
  source: ArrivalsSource | null
  status: LiveStatus
  /** The MTA's skip alerts: a row whose route and direction skip this station says so. */
  skips: AlertSkips | null
  /** The line filter, kept above the panel so a train panel covering this one doesn't reset it. */
  lineFilter: LineFilterControl
  /** Takes focus when a row, a line chip or the "Show all" button that has it goes away (a poll, or the panel unstacked). */
  onFocusLost: () => void
}

/** The destination (arrivalGroupKey) of the row holding focus inside the list, from a focus event. */
function focusedGroup(target: EventTarget | null): string | null {
  return target instanceof Element ? (target.closest('li[data-group]')?.getAttribute('data-group') ?? null) : null
}

/**
 * Next arrivals at one station, a list per direction, under a chip per line when two or more run. The clock ticks
 * in here, so a tick re-renders this list and nothing else. The list is not a live region (it would announce every
 * tick); only the state line is, and not while the header already announces that live data is delayed. The filter
 * applies first, then the collapse: a panel stacked over the map (phones in portrait) shows the COLLAPSED_ARRIVALS
 * destinations due soonest of the chosen line, always keeping the focused one, at a fixed height (CollapsedSizer),
 * and "Show all N destinations", which then scrolls by whole rows (useListScroll). Key it by station so a new
 * station starts collapsed.
 */
export function ArrivalsList({ network, station, source, status, skips, lineFilter, onFocusLost }: ArrivalsListProps) {
  const { selectTrain } = useTrainSelection()
  const stacked = useStackedPanel()
  const [expanded, setExpanded] = useState(false)
  const [focused, setFocused] = useState<string | null>(null)
  const [spoken, setSpoken] = useState('')
  // The scroller is a focusable region only while it overflows, but it keeps that while it holds focus, so a poll
  // that shrinks the list below the cap doesn't drop focus to the page.
  const [scrollerFocused, setScrollerFocused] = useState(false)
  const spokenTimer = useRef(0)
  const listId = useId()
  const headingId = useId()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => () => window.clearTimeout(spokenTimer.current), [])

  // The chips are the station's lines (a complex's, every member's): fixed, so no poll moves one.
  const lines = useMemo(() => stationLines(station.routeIds), [station])
  const chosen = lineFilter.line
  const chosenChip = chosen === null ? undefined : lines.find((c) => c.key === chosen)
  const spokenName = (chip: LineChoice) => routeSpokenName(network.routeById.get(chip.routeId)?.shortName ?? chip.routeId)

  // `tick` is not read: it is what makes this recompute against the advancing clock.
  const { nowS, everything, groups, health } = useMemo(() => {
    if (!source) return { nowS: 0, everything: null, groups: null, health: null }
    const now = clockNow(source.offsetS, performance.now())
    const found = arrivalsAt(source.snapshot, station, now, {
      lookup: source.lookup,
      routeById: network.routeById,
      stationName: (id) => network.stationById.get(id)?.name,
    })
    const routeIds = chosen === null ? station.routeIds : station.routeIds.filter((id) => lineKey(id) === chosen)
    return {
      nowS: now,
      everything: found,
      groups: filterArrivals(found, chosen),
      health: stationFeedHealth(source.snapshot, routeIds, source.failures, now),
    }
  }, [source, station, network, chosen, tick])
  const due = useMemo(() => (everything === null ? null : linesDue(everything)), [everything])

  const toggle = (key: string) => {
    const chip = lines.find((c) => c.key === key)
    setSpoken(
      chosen === key || !chip
        ? lineFilterAnnouncement(null, 0)
        : lineFilterAnnouncement(spokenName(chip), filterArrivals(everything ?? [], key).length),
    )
    window.clearTimeout(spokenTimer.current)
    spokenTimer.current = window.setTimeout(() => setSpoken(''), ANNOUNCE_CLEAR_MS)
    lineFilter.toggle(key)
  }

  const routeName = (id: string) => network.routeById.get(id)?.shortName ?? id
  const view = deriveArrivalsView(status, groups, health, routeName)
  const stateLines = view.kind === 'message' ? [view.text] : view.notes
  const announce = status.kind !== 'stale' ? ({ role: 'status', 'aria-live': 'polite' } as const) : {}
  const all = view.kind === 'rows' ? view.sections : []
  const total = arrivalGroupCount(all)
  // A chosen line with nothing due keeps the collapsed height, so a poll doesn't shrink the panel.
  const collapsed = stacked && !expanded && (view.kind === 'rows' || (view.kind === 'empty' && chosen !== null))
  const sections = collapsed ? soonestSections(all, COLLAPSED_ARRIVALS, focused) : all
  const showToggle = stacked && total > 0 && (expanded || total > COLLAPSED_ARRIVALS)
  const emptyText = view.kind !== 'empty' ? null : chosenChip ? `No upcoming ${spokenName(chosenChip)} trains` : 'No upcoming trains'
  // Collapsed, the message sits in the sizer's cell, so a line flipping between rows and none keeps the height.
  const emptyInCell = collapsed && emptyText !== null
  const { scroller, list, capPx, overflows, atEnd, onScroll } = useListScroll<HTMLDivElement>(arrivalGroupCount(sections), 'li[data-group]')
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocused(null)
  }

  return (
    <section className="mt-3 min-h-24">
      <h3 id={headingId} className="sr-only">
        Arrivals
      </h3>
      {view.kind !== 'message' && (
        <LineFilter lines={lines} pressed={chosen} due={due} routeById={network.routeById} onToggle={toggle} onFocusLost={onFocusLost} />
      )}
      <p role="status" className="sr-only">
        {spoken}
      </p>
      <div {...announce}>
        {stateLines.map((text) => (
          <p key={text} className="mt-1 text-xs text-ink-dim">
            {text}
          </p>
        ))}
      </div>
      {emptyText !== null && !emptyInCell && <p className="mt-1 text-sm">{emptyText}</p>}
      <div className="relative">
        {/* Capped at whole rows while the stacked panel is expanded (useListScroll); a focusable region only while it
            scrolls. The negative margin and padding give the rows' hover fill and focus ring room inside the clip. */}
        <div
          ref={scroller}
          onScroll={onScroll}
          style={capPx === null ? undefined : { maxHeight: capPx }}
          onFocus={(e) => e.target === e.currentTarget && setScrollerFocused(true)}
          onBlur={(e) => e.target === e.currentTarget && setScrollerFocused(false)}
          {...(overflows || scrollerFocused ? ({ role: 'region', 'aria-labelledby': headingId, tabIndex: 0 } as const) : {})}
          className="relative -mx-1 overflow-y-auto overscroll-contain px-1 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <div className="grid">
            {collapsed && <CollapsedSizer note={stationHasSkip(skips, station.routeIds, station.memberIds, nowS)} />}
            <div
              ref={list}
              id={listId}
              className="col-start-1 row-start-1"
              onFocus={(e) => setFocused(focusedGroup(e.target))}
              onBlur={onBlur}
            >
              {emptyInCell && <p className="mt-1 text-sm">{emptyText}</p>}
              {sections.map((groupsOfDirection, i) => (
                <ul key={groupsOfDirection[0]!.direction} className={sectionClass(i)}>
                  {groupsOfDirection.map((g) => (
                    <ArrivalRow
                      key={arrivalGroupKey(g)}
                      group={g}
                      network={network}
                      nowS={nowS}
                      drawnKeys={source?.drawnKeys ?? NO_KEYS}
                      skip={skipAt(skips, g.routeId, g.direction, station.memberIds, nowS)}
                      onSelect={selectTrain}
                      onFocusLost={onFocusLost}
                    />
                  ))}
                </ul>
              ))}
            </div>
          </div>
        </div>
        {overflows && !atEnd && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-panel to-transparent" />
        )}
      </div>
      {showToggle && (
        <ShowAll expanded={expanded} controls={listId} total={total} onToggle={() => setExpanded((e) => !e)} onFocusLost={onFocusLost} />
      )}
    </section>
  )
}
