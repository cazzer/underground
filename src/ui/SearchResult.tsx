import { boroughName } from '../lib/labels'
import type { Network, Station } from '../lib/network'
import { StationName } from './AccessIcon'
import { RouteChip } from './RouteChip'

interface SearchResultProps {
  id: string
  network: Network
  station: Station
  /** Another station has this name: show the borough under it. */
  sharedName: boolean
  active: boolean
  onChoose: () => void
  onActive: () => void
}

/**
 * One listbox option: the name and access icon, the borough when another station shares the name, then a chip
 * per route (the chips are what tell same-borough duplicates apart).
 */
export function SearchResult({ id, network, station, sharedName, active, onChoose, onActive }: SearchResultProps) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onClick={onChoose}
      onPointerMove={(e) => e.pointerType === 'mouse' && onActive()}
      className={`flex min-h-11 cursor-pointer flex-col justify-center gap-1 border-l-4 px-3 py-2 ${
        active ? 'border-focus bg-panel' : 'border-transparent'
      }`}
    >
      <span className="text-base leading-tight">
        <StationName name={station.name} access={station.access} context="row" />
      </span>
      {sharedName && station.borough && <span className="text-xs leading-tight text-ink-dim">{boroughName(station.borough)}</span>}
      <span className="flex flex-wrap gap-1.5">
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
    </li>
  )
}
