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

/**
 * The name as a sign would print it. A type word is shortened when it ends the name ("Bedford Avenue" → "Bedford Av"),
 * when only a compass word follows it ("Park Avenue South" → "Park Av S", the compass word shortened too), when
 * "Service" and a closing type word follow it ("1st Avenue Service Road" → "1 Av Service Rd"), or when it opens a
 * two-word name before a single letter ("Avenue U" → "Av U"). An ordinal loses its suffix before a shortened type
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
    if (i === n - 2 && COMPASS[key(n - 1)] !== undefined) return true
    if (i === n - 3 && key(i + 1) === 'service' && isType(n - 1)) return true
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

/** What the entrance label needs from a street file's entrance. */
export type LabelledEntrance = Pick<StreetEntrance, 'street' | 'cross' | 'side' | 'plaza' | 'type' | 'entry' | 'exit'>

/**
 * The text beside an entrance mark, street first: "Bedford Av & N 7 St · NE corner", "Broadway median at W 95 St",
 * "Bedford Av · east side", the street (and cross street) alone when no side is known, or the plaza's name when no
 * street is in range. " · elevator" for an elevator entrance, " · exit only" when it can't be entered, " · entry
 * only" when it can't be left by. Null when the entrance has neither a street nor a plaza.
 */
export function entranceLabel(e: LabelledEntrance): string | null {
  let text: string
  if (e.street === null) {
    if (e.plaza === null) return null
    text = e.plaza
  } else {
    const street = abbreviateStreet(e.street)
    const cross = e.cross === null ? null : abbreviateStreet(e.cross)
    if (e.side === 'median') text = cross ? `${street} median at ${cross}` : `${street} median`
    else {
      text = cross ? `${street} & ${cross}` : street
      if (e.side !== null) text += ` · ${SIDE_WORDS[e.side]}`
    }
  }
  if (e.type === 'Elevator') text += ' · elevator'
  if (!e.entry) text += ' · exit only'
  else if (!e.exit) text += ' · entry only'
  return text
}
