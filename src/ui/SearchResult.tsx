import { boroughName } from '../lib/labels'
import type { Network } from '../lib/network'
import type { StationGroup } from '../lib/stationGroups'
import type { SearchItem } from '../lib/searchItems'
import { rowName, type RowAction } from '../lib/searchRowActions'
import type { TripEnd } from '../lib/trip'
import { StationName } from './AccessIcon'
import { ResultRow } from './ResultRow'
import { RouteChip } from './RouteChip'

interface SearchResultProps {
  row: number
  highlighted: boolean
  actions: readonly RowAction[]
  network: Network
  item: Extract<SearchItem<StationGroup>, { kind: 'station' }>
  /** Stations with this name lie in more than one borough: show this one's under the name. */
  showBorough: boolean
  onChoose: () => void
  onDirections: (end: TripEnd) => void
}

/**
 * One station row: the name and access icon, the complex's other names ("with …"), the borough when the name is used in more than one borough, then
 * a chip per route (the chips are what tell same-borough duplicates apart). Hidden commas keep the spoken parts
 * apart; after the access label, which ends in a period, none is needed.
 */
export function SearchResult({ row, highlighted, actions, network, item, showBorough, onChoose, onDirections }: SearchResultProps) {
  const { station } = item
  const borough = showBorough && station.borough ? boroughName(station.borough) : null
  const spokenPeriod = station.access.status !== 'none'
  const withNames = station.otherNames.length > 0
  return (
    <ResultRow row={row} highlighted={highlighted} actions={actions} name={rowName(item, borough)} onChoose={onChoose} onDirections={onDirections}>
      <span className="text-base leading-tight">
        <StationName name={station.name} access={station.access} context="row" />
      </span>
      {withNames && (
        <span className="text-xs leading-tight text-ink-dim">
          {!spokenPeriod && <span className="sr-only">, </span>}
          with {station.otherNames.join(', ')}
        </span>
      )}
      {borough && (
        <span className="text-xs leading-tight text-ink-dim">
          {(!spokenPeriod || withNames) && <span className="sr-only">, </span>}
          {borough}
        </span>
      )}
      <span className="flex flex-wrap gap-1.5">
        {(borough || withNames || !spokenPeriod) && <span className="sr-only">, </span>}
        {station.routeIds.map((routeId, i) => {
          const route = network.routeById.get(routeId)
          if (!route) throw new Error(`Station ${station.id} lists unknown route "${routeId}"`)
          return (
            <RouteChip key={routeId} route={route} as="span">
              <span className="sr-only">
                {route.shortName}: {route.longName}
                {i < station.routeIds.length - 1 && ','}
              </span>
            </RouteChip>
          )
        })}
      </span>
    </ResultRow>
  )
}
