import type { RouteId } from '../data/schema'
import { routeSpokenName } from '../lib/labels'
import type { AlertListRow } from '../lib/live/alertList'
import type { Route } from '../lib/network'
import { RouteChip } from './RouteChip'

interface ServiceChangeRowProps {
  row: AlertListRow
  routeById: ReadonlyMap<RouteId, Route>
  /** This row's change is the one the map draws. */
  picked: boolean
  /** The picked row's note (changeDrawNote); null while it isn't picked. */
  note: string | null
  /** A drawable row's press: draws its change on the map, or clears it when it is the one drawn. */
  onPick: (alertId: string) => void
}

function RowContent({ row, routeById }: Pick<ServiceChangeRowProps, 'row' | 'routeById'>) {
  return (
    <>
      <span className="flex items-start gap-1.5 text-xs">
        <span className="flex shrink-0 flex-wrap gap-1">
          {row.routeIds.map((id) => {
            const route = routeById.get(id)
            return route ? (
              <RouteChip key={id} route={route} as="span">
                <span className="sr-only">{routeSpokenName(route.shortName)} train</span>
              </RouteChip>
            ) : (
              <span key={id} className="border-2 border-edge px-1.5 text-ink">
                {id}
              </span>
            )
          })}
        </span>
        {row.when !== '' && <span className="min-w-0 pt-px text-ink-dim">{row.when}</span>}
      </span>
      <span className="mt-1 block text-sm break-words whitespace-pre-line text-ink group-hover:underline">{row.header}</span>
    </>
  )
}

/**
 * One service change: its lines, when, and the MTA's header over them. The header is the MTA's own text: a plain
 * text node (never HTML), not edited, truncated or re-cased; only the line breaks it carries are kept. A change the
 * map can draw (`row.drawable`) is a toggle button named by that content: pressed, the map draws it and a dim line
 * under it says the drawing is ours (`note`, also its description); a press keeps focus and speaks nothing more.
 * Any other row is plain text.
 */
export function ServiceChangeRow({ row, routeById, picked, note, onPick }: ServiceChangeRowProps) {
  return (
    <li data-alert={row.id} className="border-t border-edge py-2 first:border-t-0">
      {row.drawable ? (
        <button
          type="button"
          aria-pressed={picked}
          aria-description={picked && note ? note : 'Show on the map'}
          onClick={() => onPick(row.id)}
          className={`group -ml-2.5 block w-[calc(100%+0.625rem)] cursor-pointer border-l-2 pl-2 text-left focus-visible:outline-2 focus-visible:outline-focus ${picked ? 'border-focus' : 'border-transparent'}`}
        >
          <RowContent row={row} routeById={routeById} />
        </button>
      ) : (
        <div>
          <RowContent row={row} routeById={routeById} />
        </div>
      )}
      {picked && note && (
        <p aria-hidden="true" className="mt-1 text-xs text-ink-dim">
          {note}
        </p>
      )}
    </li>
  )
}
