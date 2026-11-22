import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { EntranceText } from '../lib/entranceText'
import { entranceRows, entranceTotal, type EntranceRow } from '../lib/entranceList'
import { useListScroll } from './useListScroll'
import { usePhoneViewport } from './usePhoneViewport'

/** Rows shown before "Show all N entrances" (on a phone none: the section starts as a closed disclosure). */
const COLLAPSED_ROWS = 3

interface RowProps {
  row: EntranceRow
}

/** The visible wording is hidden from screen readers, which get the spoken form (full names, corners spelled out). */
function Row({ row }: RowProps) {
  return (
    <li className="py-1.5 leading-tight">
      <span aria-hidden="true">
        {row.parts.map((part, i) => (
          <span key={i}>
            {part.sep}
            <span className={part.keep ? 'whitespace-nowrap' : undefined}>{part.text}</span>
          </span>
        ))}
        {row.count > 1 && (
          <>
            {' '}
            <span className="whitespace-nowrap text-ink-dim">({row.count})</span>
          </>
        )}
      </span>
      <span className="sr-only">{row.spoken}</span>
    </li>
  )
}

interface ToggleProps {
  expanded: boolean
  controls: string | undefined
  onToggle: () => void
  /** Called when the button goes away while it has focus. */
  onFocusLost: () => void
  className: string
  children: ReactNode
}

function Toggle({ expanded, controls, onToggle, onFocusLost, className, children }: ToggleProps) {
  const button = useRef<HTMLButtonElement>(null)
  const lost = useRef(onFocusLost)
  useLayoutEffect(() => {
    lost.current = onFocusLost
  })
  // The layout cleanup of an unmounting child runs before React removes its node, so focus can still be read.
  // Empty deps: it must run only on unmount, however the parent's callback changes.
  useLayoutEffect(
    () => () => {
      if (button.current !== null && button.current === document.activeElement) lost.current()
    },
    [],
  )
  return (
    <button
      ref={button}
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className={`cursor-pointer focus-visible:outline-2 focus-visible:outline-focus ${className}`}
    >
      {children}
    </button>
  )
}

interface EntranceListProps {
  /** The focused station's labelled entrances (the street file's), null until they load or when it has none. */
  entrances: readonly EntranceText[] | null
  /** Takes focus when the button that has it goes away (a resize across the phone breakpoint, another station). */
  onFocusLost: () => void
}

/**
 * Where the focused station's entrances open onto the street, in the map labels' words, for everyone and for screen
 * readers (the labels are aria-hidden; each row has a spoken form). Wider screens show three rows and "Show all N
 * entrances"; a phone shows a closed "Entrances (N)" disclosure, so the panel stays short over the map. Not a live
 * region, and nothing while the street file loads or when the station has no labelled entrance. Key it by station
 * so a new station starts collapsed.
 */
export function EntranceList({ entrances, onFocusLost }: EntranceListProps) {
  const phone = usePhoneViewport()
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const headingId = useId()
  const all = useMemo(() => (entrances ? entranceRows(entrances) : []), [entrances])
  const rows = expanded ? all : phone ? [] : all.slice(0, COLLAPSED_ROWS)
  const { scroller, list, capPx, overflows, atEnd, onScroll } = useListScroll<HTMLUListElement>(rows.length)
  if (all.length === 0) return null
  const total = entranceTotal(all)
  const toggle = () => setExpanded((e) => !e)
  return (
    <section className="mt-3">
      <h3 id={headingId} className="text-xs uppercase tracking-widest text-ink-dim">
        {phone ? (
          <Toggle
            expanded={expanded}
            controls={rows.length > 0 ? listId : undefined}
            onToggle={toggle}
            onFocusLost={onFocusLost}
            className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between px-2 uppercase tracking-widest hover:text-ink"
          >
            <span>Entrances ({total})</span>
            <span aria-hidden="true">{expanded ? '−' : '+'}</span>
          </Toggle>
        ) : (
          'Entrances'
        )}
      </h3>
      {rows.length > 0 && (
        <div className="relative mt-1">
          {/* Capped at whole rows on a phone like the train's stop list; a focusable region only while it scrolls. */}
          <div
            ref={scroller}
            onScroll={onScroll}
            style={capPx === null ? undefined : { maxHeight: capPx }}
            {...(overflows ? ({ role: 'region', 'aria-labelledby': headingId, tabIndex: 0 } as const) : {})}
            className="relative overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-focus"
          >
            <ul ref={list} id={listId} className="divide-y divide-edge/30 text-sm">
              {rows.map((row) => (
                <Row key={row.key} row={row} />
              ))}
            </ul>
          </div>
          {overflows && !atEnd && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-panel to-transparent" />
          )}
        </div>
      )}
      {!phone && all.length > COLLAPSED_ROWS && (
        <Toggle
          expanded={expanded}
          controls={listId}
          onToggle={toggle}
          onFocusLost={onFocusLost}
          className="-mx-2 mt-1 flex min-h-11 items-center px-2 text-sm text-ink-dim hover:text-ink"
        >
          {expanded ? 'Show fewer' : `Show all ${total} entrances`}
        </Toggle>
      )}
    </section>
  )
}
