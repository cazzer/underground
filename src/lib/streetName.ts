/** Street names and entrance wording for the street labels, in MTA signage style ("W 96 St", "Bedford Av"). Pure. */
import type { StreetEntrance, StreetSide } from '../data/streetSchema'

/** Street type words and their short forms; a key is the word lowercased with any trailing period dropped. */
const TYPE_WORDS: Readonly<Record<string, string>> = {
  avenue: 'Av',
  ave: 'Av',
  av: 'Av',
  street: 'St',
  st: 'St',
  place: 'Pl',
  pl: 'Pl',
  boulevard: 'Blvd',
  blvd: 'Blvd',
  road: 'Rd',
  rd: 'Rd',
  parkway: 'Pkwy',
  pkwy: 'Pkwy',
  square: 'Sq',
  sq: 'Sq',
  lane: 'Ln',
  ln: 'Ln',
  drive: 'Dr',
  dr: 'Dr',
  court: 'Ct',
  ct: 'Ct',
  terrace: 'Ter',
  ter: 'Ter',
  highway: 'Hwy',
  hwy: 'Hwy',
  expressway: 'Expy',
  expy: 'Expy',
  extension: 'Ext',
  ext: 'Ext',
}

const DIRECTIONS: Readonly<Record<string, string>> = { north: 'N', south: 'S', east: 'E', west: 'W' }

const ORDINAL = /^(\d+)(st|nd|rd|th)$/i
const NUMBERED = /^\d/
const SINGLE_LETTER = /^[A-Za-z]$/

/** Compass words, long or already short, as a trailing suffix ("Park Avenue South"). */
const COMPASS: Readonly<Record<string, string>> = { ...DIRECTIONS, n: 'N', s: 'S', e: 'E', w: 'W' }
/** Words that are always shortened, wherever they stand. */
const ALWAYS: Readonly<Record<string, string>> = { saint: 'St', fort: 'Ft' }

const keyOf = (word: string) => word.toLowerCase().replace(/\.$/, '')

/** What may follow a type word that is still shortened: one compass word ("Park Avenue South"), "Extension"
 *  ("Flatbush Avenue Extension"), "Service" and a type word ("1st Avenue Service Road"), or "Bus Loop". */
function closingTail(keys: readonly string[]): boolean {
  if (keys.length === 1) return COMPASS[keys[0]!] !== undefined || keys[0] === 'extension' || keys[0] === 'ext'
  if (keys.length !== 2) return false
  return (keys[0] === 'service' && TYPE_WORDS[keys[1]!] !== undefined) || (keys[0] === 'bus' && keys[1] === 'loop')
}

/**
 * The name as a sign would print it. A type word is shortened when it ends the name ("Bedford Avenue" → "Bedford Av"),
 * when only a closing tail follows it (`closingTail`: "Park Av S", the compass word shortened too; "Flatbush Av Ext";
 * "1 Av Service Rd"; "Mermaid Av Bus Loop"), or when it opens a two-word name before a single letter ("Avenue U" →
 * "Av U"). An ordinal loses its suffix before a shortened type
 * word ("5th Avenue" → "5 Av"); a leading compass word is shortened only before a numbered word ("North 7th Street"
 * → "N 7 St"), so "West End Avenue" and "East Broadway" keep theirs. Saint and Fort are always St and Ft. Other
 * words stay as written.
 */
export function abbreviateStreet(name: string): string {
  const words = name.trim().split(/\s+/)
  const n = words.length
  const key = (i: number) => (i >= 0 && i < n ? keyOf(words[i]!) : '')
  const isType = (i: number) => TYPE_WORDS[key(i)] !== undefined
  const typeAt = (i: number): boolean => {
    if (!isType(i)) return false
    if (i === n - 1) return true
    if (i >= n - 3 && closingTail(words.slice(i + 1).map(keyOf))) return true
    return i === 0 && n === 2 && SINGLE_LETTER.test(words[1]!)
  }
  const out = words.map((word, i) => {
    const always = ALWAYS[key(i)]
    if (always) return always
    if (typeAt(i)) return TYPE_WORDS[key(i)]!
    if (i === n - 1 && COMPASS[key(i)] !== undefined && typeAt(i - 1)) return COMPASS[key(i)]!
    const ordinal = ORDINAL.exec(word)
    if (ordinal && typeAt(i + 1)) return ordinal[1]!
    const direction = DIRECTIONS[key(i)]
    if (direction && i + 1 < n && NUMBERED.test(words[i + 1]!)) return direction
    return word
  })
  return out.join(' ')
}

const SIDE_WORDS: Readonly<Record<Exclude<StreetSide, 'median'>, string>> = {
  north: 'north side',
  south: 'south side',
  east: 'east side',
  west: 'west side',
  NE: 'NE corner',
  SE: 'SE corner',
  SW: 'SW corner',
  NW: 'NW corner',
}

/** The sides as said aloud: the corners spelled out. */
const SPOKEN_SIDE_WORDS: Readonly<Record<Exclude<StreetSide, 'median'>, string>> = {
  ...SIDE_WORDS,
  NE: 'northeast corner',
  SE: 'southeast corner',
  SW: 'southwest corner',
  NW: 'northwest corner',
}

/** What the entrance label needs from a street file's entrance. */
export type LabelledEntrance = Pick<StreetEntrance, 'street' | 'cross' | 'side' | 'plaza' | 'type' | 'entry' | 'exit'>

/** Station-level wording choices (entranceText.ts): the corner pair's order, and for an entrance with no cross
 *  street the nearest other street (`near`, verbatim) and, when two labels would still match, which side of it. */
export interface EntranceWording {
  swap?: boolean
  /** The nearest other street (verbatim) of an entrance with no cross street. */
  near?: string
  /** Which side of `near` the entrance is on, said when two labels would otherwise match. */
  of?: 'N' | 'S' | 'E' | 'W'
  /** A median entrance between two streets (verbatim, in reading order). */
  between?: readonly [string, string]
}

/** A label in two parts, for two lines on a phone: the street part, then the rest ('' when there is none). */
export interface EntranceParts {
  head: string
  tail: string
}

const COMPASS_WORDS = { N: 'north', S: 'south', E: 'east', W: 'west' } as const

/** Two streets as one phrase, sharing a closing type word: "W 95 & W 96 St", else "Broadway & W 96 St". */
export function streetPair(a: string, b: string): string {
  const x = abbreviateStreet(a).split(' ')
  const y = abbreviateStreet(b).split(' ')
  const last = x.at(-1)!
  if (x.length > 1 && y.length > 1 && last === y.at(-1) && Object.values(TYPE_WORDS).includes(last)) {
    return `${x.slice(0, -1).join(' ')} & ${y.join(' ')}`
  }
  return `${x.join(' ')} & ${y.join(' ')}`
}

/** How `wording` names things: the label's abbreviated, ampersanded style, or the full names the file holds, said aloud. */
interface Style {
  name: (street: string) => string
  pair: (a: string, b: string) => string
  and: string
  sides: Readonly<Record<Exclude<StreetSide, 'median'>, string>>
}

const LABEL_STYLE: Style = { name: abbreviateStreet, pair: streetPair, and: ' & ', sides: SIDE_WORDS }
const SPOKEN_STYLE: Style = {
  name: (street) => street.trim(),
  pair: (a, b) => `${a.trim()} and ${b.trim()}`,
  and: ' and ',
  sides: SPOKEN_SIDE_WORDS,
}

function wording(e: LabelledEntrance, w: EntranceWording, st: Style): { head: string; tail: string[] } | null {
  let head: string
  const tail: string[] = []
  if (e.street === null) {
    if (e.plaza === null) return null
    head = e.plaza
  } else {
    const street = st.name(e.street)
    const cross = e.cross === null ? null : st.name(e.cross)
    const near = w.near === undefined ? null : st.name(w.near)
    const of = near !== null && w.of ? `${COMPASS_WORDS[w.of]} of ${near}` : null
    if (e.side === 'median') {
      head = `${street} median`
      if (cross) tail.push(`at ${cross}`)
      else if (of) tail.push(of)
      else if (w.between) tail.push(`between ${st.pair(...w.between)}`)
      else if (near) tail.push(`near ${near}`)
    } else if (cross) {
      head = w.swap ? `${cross}${st.and}${street}` : `${street}${st.and}${cross}`
      if (e.side !== null) tail.push(st.sides[e.side])
    } else {
      head = street
      const side = e.side === null ? null : st.sides[e.side]
      if (of) tail.push(...(side ? [side, of] : [of]))
      else if (near) tail.push(side ? `${side} at ${near}` : `at ${near}`)
      else if (side) tail.push(side)
    }
  }
  if (e.type === 'Elevator') tail.push('elevator')
  if (!e.entry) tail.push('exit only')
  else if (!e.exit) tail.push('entry only')
  return { head, tail }
}

/**
 * The text beside an entrance mark, street first: "Bedford Av & N 7 St" / "NE corner", "Broadway median" / "at W 95
 * St" (or "between W 95 & W 96 St", "near W 95 St"), "Broadway" / "west side at W 94 St" (or "east side · north of
 * N 7 St" when two would match), the street (and cross street) alone when no side is known, or the plaza's name when
 * no street is in range. "elevator" for an elevator entrance, "exit only" when it can't be entered, "entry only"
 * when it can't be left by. Null when the entrance has neither a street nor a plaza.
 */
export function entranceParts(e: LabelledEntrance, w: EntranceWording = {}): EntranceParts | null {
  const p = wording(e, w, LABEL_STYLE)
  return p && { head: p.head, tail: p.tail.join(' · ') }
}

/**
 * The same entrance as a screen reader should say it: the file's own full street names (never a re-expansion of the
 * abbreviations), "and" for "&", corners spelled out, the parts joined with commas: "Bedford Avenue and North 7th
 * Street, northeast corner, elevator". The same wording choices `w` as the label, so the two always agree.
 */
export function entranceSpoken(e: LabelledEntrance, w: EntranceWording = {}): string | null {
  const p = wording(e, w, SPOKEN_STYLE)
  return p && [p.head, ...p.tail].join(', ')
}

const RELATION = /^(at|near|between|(north|south|east|west) of) /

/** What goes between a label's head and its tail: a space before a relation ("at W 95 St"), else " · ". */
export function partsSeparator(tail: string): string {
  return RELATION.test(tail) ? ' ' : ' · '
}

/** The parts on one line: "Broadway median at W 95 St", "Bedford Av & N 7 St · NE corner · elevator". */
export function joinParts(p: EntranceParts): string {
  if (p.tail === '') return p.head
  return `${p.head}${partsSeparator(p.tail)}${p.tail}`
}

/** `entranceParts` on one line. */
export function entranceLabel(e: LabelledEntrance, w: EntranceWording = {}): string | null {
  const p = entranceParts(e, w)
  return p && joinParts(p)
}
