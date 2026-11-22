/** The buttons a search result row shows and what they are called (pure). */
import type { SearchItem } from './searchItems'
import type { SearchableStation } from './stationSearch'

export type RowAction = 'choose' | 'from' | 'to'

const WITH_DIRECTIONS: readonly RowAction[] = ['choose', 'from', 'to']
const CHOOSE_ONLY: readonly RowAction[] = ['choose']

/** The row's buttons, in order. Directions appear only where the dialog offers them (the HUD's search); every kind of row gets the same. */
export function rowActions(directions: boolean): readonly RowAction[] {
  return directions ? WITH_DIRECTIONS : CHOOSE_ONLY
}

/** The row's short name for the directions labels: a station's name (", <borough>" when the row shows it), a place's "120 Broadway, Manhattan". */
export function rowName(item: SearchItem<SearchableStation>, borough: string | null): string {
  if (item.kind === 'station') return borough ? `${item.station.name}, ${borough}` : item.station.name
  return item.text.detail ? `${item.text.name}, ${item.text.detail}` : item.text.name
}

export function directionsLabel(action: 'from' | 'to', name: string): string {
  return `Directions ${action} ${name}`
}
