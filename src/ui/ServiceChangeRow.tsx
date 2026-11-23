import type { RouteId } from '../data/schema'
import { routeSpokenName } from '../lib/labels'
import type { AlertListRow } from '../lib/live/alertList'
import type { Route } from '../lib/network'
import { RouteChip } from './RouteChip'

interface ServiceChangeRowProps {
  row: AlertListRow
  routeById: ReadonlyMap<RouteId, Route>
}

/**
 * One service change: its lines, when, and the MTA's header over them. The header is the MTA's own text: a plain
 * text node (never HTML), not edited, truncated or re-cased; only the line breaks it carries are kept. Plain text for
 * now, so picking a row is a later step: 08r.6 swaps the inner `div` for a `button`.
 */
export function ServiceChangeRow({ row, routeById }: ServiceChangeRowProps) {
  return (
    <li data-alert={row.id} className="border-t border-edge py-2 first:border-t-0">
      <div>
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
        <span className="mt-1 block text-sm break-words whitespace-pre-line text-ink">{row.header}</span>
      </div>
    </li>
  )
}
