import type { ReactNode } from 'react'
import { GEOCODE_ATTRIBUTION, type GeocodeSource } from '../data/realtime'
import { GEOCODE_ERROR_TEXT, type GeocodeView } from '../lib/geocodeView'
import type { Network, Station } from '../lib/network'
import type { SearchItem } from '../lib/searchItems'
import { PlaceResult } from './PlaceResult'
import { SearchResult } from './SearchResult'

interface SearchResultsProps {
  network: Network
  listId: string
  items: readonly SearchItem<Station>[]
  /** Index of the active item in `items`, or -1. */
  current: number
  optionId: (key: string) => string
  multiBorough: ReadonlySet<string>
  view: GeocodeView
  /** Places are searched: the listbox keeps its grouped structure from the first row, so no station option remounts when places arrive. */
  grouped: boolean
  emptyText: string | null
  keyboardInset: number
  onChoose: (item: SearchItem<Station>) => void
  onActive: (index: number) => void
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
 * The dialog's scroll area: the listbox (stations alone as one flat list, as before; with places searched, always the
 * grouped listbox, a "Stations" group and, once there are rows, an "Addresses and places" group), the notes a status region already speaks, and the credit. Option ids come
 * from `optionId` so the input's `aria-activedescendant` can name any of them.
 */
export function SearchResults({ network, listId, items, current, optionId, multiBorough, view, grouped, emptyText, keyboardInset, onChoose, onActive }: SearchResultsProps) {
  const stationRows: ReactNode[] = []
  const placeRows: ReactNode[] = []
  items.forEach((item, i) => {
    if (item.kind === 'station') {
      stationRows.push(
        <SearchResult
          key={item.key}
          id={optionId(item.key)}
          network={network}
          station={item.station}
          showBorough={multiBorough.has(item.station.name)}
          active={i === current}
          onChoose={() => onChoose(item)}
          onActive={() => onActive(i)}
        />,
      )
    } else {
      placeRows.push(
        <PlaceResult key={item.key} id={optionId(item.key)} text={item.text} active={i === current} onChoose={() => onChoose(item)} onActive={() => onActive(i)} />,
      )
    }
  })
  const headingId = `${listId}-places`
  const searching = view.status === 'pending' && view.tier >= 1
  return (
    <div style={{ paddingBottom: keyboardInset }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {items.length > 0 &&
        (grouped ? (
          <div id={listId} role="listbox" aria-label="Stations, addresses and places">
            {stationRows.length > 0 && (
              <ul role="group" aria-label="Stations">
                {stationRows}
              </ul>
            )}
            {placeRows.length > 0 && (
              <ul role="group" aria-labelledby={headingId}>
                <li role="presentation" id={headingId} className="px-3 pt-3 pb-1 text-xs text-ink-dim uppercase">
                  Addresses and places
                </li>
                {placeRows}
              </ul>
            )}
          </div>
        ) : (
          <ul id={listId} role="listbox" aria-label="Stations">
            {stationRows}
          </ul>
        ))}
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
