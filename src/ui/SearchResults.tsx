import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { GEOCODE_ATTRIBUTION, type GeocodeSource } from '../data/realtime'
import { GEOCODE_ERROR_TEXT, type GeocodeView } from '../lib/geocodeView'
import type { Network } from '../lib/network'
import type { StationGroup } from '../lib/stationGroups'
import type { SearchItem } from '../lib/searchItems'
import { rowName, type RowAction } from '../lib/searchRowActions'
import type { TripEnd } from '../lib/trip'
import { PlaceResult } from './PlaceResult'
import { SearchResult } from './SearchResult'

interface SearchResultsProps {
  network: Network
  items: readonly SearchItem<StationGroup>[]
  /** Enter in the input picks the first row: mark it while text is typed and the input has focus. */
  highlightFirst: boolean
  /** Each row's buttons (`rowActions`). */
  actions: readonly RowAction[]
  multiBorough: ReadonlySet<string>
  view: GeocodeView
  emptyText: string | null
  keyboardInset: number
  onChoose: (item: SearchItem<StationGroup>) => void
  onDirections: (item: SearchItem<StationGroup>, end: TripEnd) => void
  /** Arrow, Home, End and printable keys from a row's buttons. */
  onRowKey: (e: KeyboardEvent<HTMLElement>) => void
}

const LINK_CLASS =
  'underline underline-offset-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

function sourcesOf(view: GeocodeView): readonly GeocodeSource[] {
  return view.status === 'ready' || view.status === 'pending' ? view.sources : []
}

const OSM_NAME = 'OpenStreetMap contributors'

/** The Photon credit as the Worker words it, with the OpenStreetMap name linked (plain text if the wording ever lacks it). */
function PhotonCredit() {
  const [before, after] = GEOCODE_ATTRIBUTION.photon.split(OSM_NAME)
  if (before === undefined || after === undefined) return <>{GEOCODE_ATTRIBUTION.photon}</>
  return (
    <>
      {before}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className={LINK_CLASS}>
        {OSM_NAME}
        <span className="sr-only"> (opens in new tab)</span>
      </a>
      {after}
    </>
  )
}

/** Credit for the sources whose rows are listed, each in the Worker contract's words. */
function SourceCredit({ sources }: { sources: readonly GeocodeSource[] }) {
  if (sources.length === 0) return null
  return (
    <p className="px-3 py-2 text-xs text-ink-dim">
      Address and place data: {sources.includes('geosearch') && GEOCODE_ATTRIBUTION.geosearch}
      {sources.length === 2 && '; '}
      {sources.includes('photon') && <PhotonCredit />}
    </p>
  )
}

/**
 * The dialog's scroll area: a "Stations" list and, once places have rows, an "Addresses and places" heading over a
 * second list, the notes a status region already speaks, and the credit. The lists are plain lists of buttons, not
 * a listbox, because a row holds more than one button; `role="list"` is explicit because Safari drops list
 * semantics from an unstyled list.
 */
export function SearchResults({ network, items, highlightFirst, actions, multiBorough, view, emptyText, keyboardInset, onChoose, onDirections, onRowKey }: SearchResultsProps) {
  const headingId = useId()
  const stationRows: ReactNode[] = []
  const placeRows: ReactNode[] = []
  items.forEach((item, i) => {
    const common = { row: i, highlighted: highlightFirst && i === 0, actions, onChoose: () => onChoose(item), onDirections: (end: TripEnd) => onDirections(item, end) }
    if (item.kind === 'station') {
      stationRows.push(<SearchResult key={item.key} {...common} network={network} item={item} showBorough={multiBorough.has(item.station.name)} />)
    } else {
      placeRows.push(<PlaceResult key={item.key} {...common} text={item.text} name={rowName(item, null)} />)
    }
  })
  const searching = view.status === 'pending' && view.tier >= 1
  return (
    <div style={{ paddingBottom: keyboardInset }} onKeyDown={onRowKey} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {stationRows.length > 0 && (
        <ul role="list" aria-label="Stations">
          {stationRows}
        </ul>
      )}
      {placeRows.length > 0 && (
        <>
          <h2 id={headingId} className="px-3 pt-3 pb-1 text-xs text-ink-dim uppercase">
            Addresses and places
          </h2>
          <ul role="list" aria-labelledby={headingId}>
            {placeRows}
          </ul>
        </>
      )}
      {emptyText && (
        <p className="p-3 text-sm text-ink-dim" aria-hidden="true">
          {emptyText}
        </p>
      )}
      {searching && (
        <p className="p-3 text-sm text-ink-dim" aria-hidden="true">
          Searching addresses and places…
        </p>
      )}
      {view.status === 'error' && (
        <p className="p-3 text-sm text-ink-dim" aria-hidden="true">
          {GEOCODE_ERROR_TEXT}
        </p>
      )}
      <SourceCredit sources={sourcesOf(view)} />
    </div>
  )
}
