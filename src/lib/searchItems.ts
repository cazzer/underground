/** The search dialog's rows as one flat list, so one key space covers stations and places (pure). */
import type { GeocodeKind, GeocodeResult } from '../data/realtime'
import type { GeocodeView } from './geocodeView'
import { placeText, type PlaceText } from './placeLabel'
import type { SearchableStation } from './stationSearch'

export type SearchItem<S extends SearchableStation> =
  | { kind: 'station'; key: string; station: S }
  | { kind: PlaceItemKind; key: string; result: GeocodeResult; text: PlaceText }

export type PlaceItemKind = 'address' | 'place' | 'street' | 'intersection'

/** Every Worker kind is a row; an area is a place. */
export function placeKind(kind: GeocodeKind): PlaceItemKind {
  return kind === 'area' ? 'place' : kind
}

/** An id-safe key; `i` tells the rare same-point twins apart. */
function placeKey(result: GeocodeResult, i: number): string {
  return `p-${result.source}-${result.lat}-${result.lon}-${i}`.replace(/[^A-Za-z0-9-]/g, '_')
}

/** Stations first, in their own order, then places in the Worker's order. */
export function searchItems<S extends SearchableStation>(stations: readonly S[], places: readonly GeocodeResult[]): SearchItem<S>[] {
  const items: SearchItem<S>[] = stations.map((station) => ({ kind: 'station', key: `s-${station.id}`, station }))
  places.forEach((result, i) => {
    items.push({ kind: placeKind(result.kind), key: placeKey(result, i), result, text: placeText(result) })
  })
  return items
}

/**
 * The row Enter picks (and the list highlights): the first. But a first row that came from /geocode, while the lookup is
 * pending (debouncing or loading), belongs to the previous text, so nothing is picked until the answer settles. A station
 * first row is always the current text's.
 */
export function enterTarget<S extends SearchableStation>(items: readonly SearchItem<S>[], view: GeocodeView): SearchItem<S> | null {
  const first = items[0]
  if (first === undefined) return null
  return first.kind !== 'station' && view.status === 'pending' ? null : first
}
