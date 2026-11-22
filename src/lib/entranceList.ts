/** The station panel's list of entrances: the same wording as the map labels (`entranceTexts`), as rows in reading
 *  order. Pure. */
import type { EntranceText } from './entranceText'

/** One row of the list. */
export interface EntranceRow {
  /** Unique within the list, stable for a station's file. */
  key: string
  /** The label's text on one line ("Bedford Av & N 7 St · NE corner · elevator"). */
  text: string
  elevator: boolean
  /** How many entrances the row stands for (same text within a few meters: one head house's stairs). */
  count: number
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })

/**
 * The labelled entrances as rows: elevators first, then by street (the label's head: its street, or street pair in
 * the station's one sign order, so by street then cross street), then by the rest of the text. Same-text entrances
 * within MERGE_M are already one label with a count, as on the map.
 */
export function entranceRows(texts: readonly EntranceText[]): EntranceRow[] {
  return texts
    .map((t) => ({ key: `${t.index}`, text: t.text, elevator: t.elevator, count: t.count, head: t.head, tail: t.tail }))
    .sort((a, b) => Number(b.elevator) - Number(a.elevator) || byName(a.head, b.head) || byName(a.tail, b.tail) || a.key.localeCompare(b.key, 'en', { numeric: true }))
    .map(({ key, text, elevator, count }) => ({ key, text, elevator, count }))
}

/** What a screen reader says after a row's text when it stands for more than one entrance ('' for one). */
export function entranceCountSpoken(count: number): string {
  return count > 1 ? `${count} entrances` : ''
}
