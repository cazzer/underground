import type { HereRow, HereStatus } from '../lib/searchHere'
import type { RowAction } from '../lib/searchRowActions'
import type { TripEnd } from '../lib/trip'
import { LocateIcon } from './LocateIcon'
import { LOCATE_GLYPH, LOCATE_TONE } from './LocateStatus'
import { ResultRow } from './ResultRow'

interface SearchHereProps {
  /** `data-row` of the control; the "My location" row takes the next. */
  firstRow: number
  row: HereRow | null
  visible: HereStatus['visible']
  locating: boolean
  /** The row's buttons (`rowActions`), as for every result row. */
  actions: readonly RowAction[]
  onPress: () => void
  onChoose: () => void
  onDirections: (end: TripEnd) => void
}

/**
 * The lead of the dialog's results while the input is blank: a "Use my location" button and, once a fix is known (from
 * this press or the header's), a "My location" row naming its nearest station. The visible status line is aria-hidden:
 * the dialog's polite region speaks it.
 */
export function SearchHere({ firstRow, row, visible, locating, actions, onPress, onChoose, onDirections }: SearchHereProps) {
  return (
    <ul role="list" aria-label="Your location">
      <li className="flex border-l-4 border-transparent">
        <button
          type="button"
          data-row={firstRow}
          data-col={0}
          onClick={onPress}
          aria-busy={locating}
          className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2 text-left text-base hover:bg-panel focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        >
          <LocateIcon pulsing={locating} />
          Use my location
        </button>
      </li>
      {visible && (
        <li aria-hidden="true" className={`px-3 pb-2 text-sm ${LOCATE_TONE[visible.tone]}`}>
          {LOCATE_GLYPH[visible.tone]} {visible.text}
        </li>
      )}
      {row && (
        <ResultRow row={firstRow + 1} highlighted={false} actions={actions} name="my location" onChoose={onChoose} onDirections={onDirections}>
          <span aria-hidden="true" className="text-base leading-tight">
            {row.title}
          </span>
          <span aria-hidden="true" className="text-xs leading-tight text-ink-dim">
            {row.detail}
          </span>
          <span className="sr-only">{row.spoken}</span>
        </ResultRow>
      )}
    </ul>
  )
}
