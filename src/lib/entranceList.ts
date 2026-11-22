/** The station panel's list of entrances: the same wording as the map labels (`entranceTexts`), as rows in reading
 *  order. Pure. */
import type { EntranceText } from './entranceText'
import { partsSeparator } from './streetName'

/** One visible piece of a row and what goes before it. */
export interface RowPart {
  /** '' for the first piece; " · " (its dot kept with the piece before it) or a space for a relation ("at W 95 St"). */
  sep: string
  /** The piece, a street number kept with its direction letter and type word ("W 116 St" never splits). */
  text: string
  /** Short enough (with its dot) to stay on one line whole: the view keeps it unbroken. A longer piece wraps between words. */
  keep: boolean
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
/** A piece, with the dot that follows it, up to this many characters is kept whole (the panel's text is about 30 wide). */
export const NOWRAP_MAX = 24
const TYPE_WORD = /(\d) (Av|St|Pl|Blvd|Rd|Pkwy|Sq|Ln|Dr|Ct|Ter|Hwy|Expy|Ext)\b/g
const DIRECTION = /\b([NSEW]) (?=\d)/g

/** A street number stays with the direction letter before it and the type word after it. */
export function glueStreetNumbers(text: string): string {
  return text.replace(TYPE_WORD, `$1${NBSP}$2`).replace(DIRECTION, `$1${NBSP}`)
}

/** The label's pieces: its head, then its tail split at the " · " the label puts between parts. */
export function rowParts(head: string, tail: string): RowPart[] {
  const raw: { sep: string; text: string }[] = [{ sep: '', text: head }]
  if (tail !== '') {
    const [first, ...rest] = tail.split(' · ')
    raw.push({ sep: partsSeparator(tail) === ' ' ? ' ' : DOT, text: first! })
    for (const text of rest) raw.push({ sep: DOT, text })
  }
  return raw.map((p, i) => {
    // The dot of the next piece stays with this one, so it counts toward what cannot break.
    const dot = raw[i + 1]?.sep === DOT ? 2 : 0
    return { sep: p.sep, text: glueStreetNumbers(p.text), keep: p.text.length + dot <= NOWRAP_MAX }
  })
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
