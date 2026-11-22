import type { ReactNode } from 'react'
import type { TripEnd } from '../lib/trip'
import { directionsLabel, type RowAction } from '../lib/searchRowActions'

interface ResultRowProps {
  /** The row's index among the dialog's results (`data-row`); a button's `data-col` is its place in `actions`. */
  row: number
  /** Enter in the input picks this row. */
  highlighted: boolean
  actions: readonly RowAction[]
  /** The row's name for the directions labels. */
  name: string
  onChoose: () => void
  onDirections: (end: TripEnd) => void
  /** The primary button's content, visible and screen-reader only. */
  children: ReactNode
}

const FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'

/**
 * One search result: a primary button that chooses it (the row's content) and, where the dialog offers directions,
 * "From" and "To" buttons. Real buttons in a plain list, not listbox options, because an option can't hold buttons;
 * the dialog moves focus between them by `data-row` and `data-col`.
 */
export function ResultRow({ row, highlighted, actions, name, onChoose, onDirections, children }: ResultRowProps) {
  return (
    <li className={`flex items-stretch border-l-4 ${highlighted ? 'border-focus bg-panel' : 'border-transparent'}`}>
      <button
        type="button"
        data-row={row}
        data-col={0}
        onClick={onChoose}
        className={`flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col justify-center gap-1 px-3 py-2 text-left hover:bg-panel ${FOCUS}`}
      >
        {children}
      </button>
      {actions.map((action, col) =>
        action === 'choose' ? null : (
          <button
            key={action}
            type="button"
            data-row={row}
            data-col={col}
            aria-label={directionsLabel(action, name)}
            onClick={() => onDirections(action)}
            className={`flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center px-2 text-sm text-ink-dim hover:text-ink ${FOCUS}`}
          >
            {action === 'from' ? 'From' : 'To'}
          </button>
        ),
      )}
    </li>
  )
}
