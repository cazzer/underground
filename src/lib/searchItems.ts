/** The search dialog's rows as one flat list, so one active index and one key space cover stations and places (pure). */
import type { GeocodeKind, GeocodeResult } from '../data/realtime'
import { placeText, type PlaceText } from './placeLabel'
import type { SearchableStation } from './stationSearch'

export type SearchItem<S extends SearchableStation> =
  | { kind: 'station'; key: string; station: S }
  | { kind: 'address' | 'place'; key: string; result: GeocodeResult; text: PlaceText }

/** Streets are the on-device search's (2q7.14), so the Worker's street rows have no kind here; an area is a place. */
export function placeKind(kind: GeocodeKind): 'address' | 'place' | null {
  if (kind === 'street') return null
  return kind === 'address' ? 'address' : 'place'
}

/** An id-safe key; `i` tells the rare same-point twins apart. */
function placeKey(result: GeocodeResult, i: number): string {
  return `p-${result.source}-${result.lat}-${result.lon}-${i}`.replace(/[^A-Za-z0-9-]/g, '_')
}

/** Stations first, in their own order, then places in the Worker's order. */
export function searchItems<S extends SearchableStation>(stations: readonly S[], places: readonly GeocodeResult[]): SearchItem<S>[] {
  const items: SearchItem<S>[] = stations.map((station) => ({ kind: 'station', key: `s-${station.id}`, station }))
  places.forEach((result, i) => {
    const kind = placeKind(result.kind)
    if (kind) items.push({ kind, key: placeKey(result, i), result, text: placeText(result) })
  })
  return items
}

/** The active row's index: its key's, else the first; -1 for an empty list. */
export function activeIndex(items: readonly SearchItem<SearchableStation>[], activeKey: string | null): number {
  if (items.length === 0) return -1
  const at = activeKey === null ? -1 : items.findIndex((item) => item.key === activeKey)
  return at === -1 ? 0 : at
}
