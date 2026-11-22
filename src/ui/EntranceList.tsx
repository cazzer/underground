import { useId, useMemo, useState } from 'react'
import type { EntranceText } from '../lib/entranceText'
import { entranceCountSpoken, entranceRows, type EntranceRow } from '../lib/entranceList'
import { useStopListScroll } from './useStopListScroll'

/** Rows shown before "Show all N exits". */
const COLLAPSED_ROWS = 3

interface RowProps {
  row: EntranceRow
}

function Row({ row }: RowProps) {
  return (
    <li className="py-1.5 leading-tight">
      {row.text}
      {row.count > 1 && (
        <>
          <span aria-hidden="true" className="text-ink-dim">
            {' '}
            ×{row.count}
          </span>
          <span className="sr-only">, {entranceCountSpoken(row.count)}</span>
        </>
      )}
    </li>
  )
}

interface EntranceListProps {
  /** The focused station's labelled entrances (the street file's), null until they load or when it has none. */
  entrances: readonly EntranceText[] | null
}

/**
 * Where the focused station's entrances open onto the street, in the map labels' words, for everyone and for screen
 * readers (the labels are aria-hidden). Collapsed to three rows; not a live region, and nothing while the street file
 * loads or when the station has no entrance with a street. Key it by station so a new station starts collapsed.
 */
export function EntranceList({ entrances }: EntranceListProps) {
  const [expanded, setExpanded] = useState(false)
  const listId = useId()
  const headingId = useId()
  const all = useMemo(() => (entrances ? entranceRows(entrances) : []), [entrances])
  const rows = expanded ? all : all.slice(0, COLLAPSED_ROWS)
  const { scroller, list, capPx, overflows, atEnd, onScroll } = useStopListScroll<HTMLUListElement>(rows.length)
  if (all.length === 0) return null
  return (
    <section className="mt-3">
      <h3 id={headingId} className="text-xs uppercase tracking-widest text-ink-dim">
        Exits
      </h3>
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
      {all.length > COLLAPSED_ROWS && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((e) => !e)}
          className="-mx-2 mt-1 flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
        >
          {expanded ? 'Show fewer' : `Show all ${all.length} exits`}
        </button>
      )}
    </section>
  )
}
