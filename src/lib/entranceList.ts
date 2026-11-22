/** The station panel's list of entrances: the same wording as the map labels (`entranceTexts`), as rows in reading
 *  order. Pure. */
import type { EntranceText } from './entranceText'
import { partsSeparator } from './streetName'

/** One visible piece of a row (it never breaks across lines) and what goes before it. */
export interface RowPart {
  /** '' for the first piece; " · " (its dot kept with the piece before it) or a space for a relation ("at W 95 St"). */
  sep: string
  text: string
}

/** One row of the list. */
export interface EntranceRow {
  /** Unique within the list, stable for a station's file. */
  key: string
  /** The label's pieces: the street part, then each part of the rest. */
  parts: RowPart[]
  /** What a screen reader says for it, the count included ("…, 2 entrances"). */
  spoken: string
  elevator: boolean
  /** How many entrances the row stands for (same text within a few meters: one head house's stairs). */
  count: number
}

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true })
/** A no-break space keeps the dot with the piece before it, so a line starts with a piece, never with a dot. */
const NBSP = String.fromCharCode(0xa0)
const DOT = `${NBSP}· `

/** The label's pieces: its head, then its tail split at the " · " the label puts between parts. */
export function rowParts(head: string, tail: string): RowPart[] {
  const parts: RowPart[] = [{ sep: '', text: head }]
  if (tail === '') return parts
  const [first, ...rest] = tail.split(' · ')
  parts.push({ sep: partsSeparator(tail) === ' ' ? ' ' : DOT, text: first! })
  for (const text of rest) parts.push({ sep: DOT, text })
  return parts
}

/** What a screen reader says after a row's wording: ", 2 entrances" for a merged row, '' for one. */
export function entranceCountSpoken(count: number): string {
  return count > 1 ? `, ${count} entrances` : ''
}

/**
 * The labelled entrances as rows: elevators first, then by street (the label's head: its street, or street pair in
 * the station's one sign order, so by street then cross street), then by the rest of the text. Same-text entrances
 * within MERGE_M are already one label with a count, as on the map.
 */
export function entranceRows(texts: readonly EntranceText[]): EntranceRow[] {
  return [...texts]
    .sort(
      (a, b) =>
        Number(b.elevator) - Number(a.elevator) ||
        byName(a.head, b.head) ||
        byName(a.tail, b.tail) ||
        byName(`${a.index}`, `${b.index}`),
    )
    .map((t) => ({
      key: `${t.index}`,
      parts: rowParts(t.head, t.tail),
      spoken: `${t.spoken}${entranceCountSpoken(t.count)}`,
      elevator: t.elevator,
      count: t.count,
    }))
}

/** How many entrances the rows stand for. */
export function entranceTotal(rows: readonly EntranceRow[]): number {
  return rows.reduce((n, r) => n + r.count, 0)
}
