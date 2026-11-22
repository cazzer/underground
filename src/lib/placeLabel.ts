/** How a searched place reads: display casing, row text, distance words, and the pick it becomes (pure). */
import type { GeocodeResult } from '../data/realtime'
import { nearestStation, type NearestStation } from './locate'
import type { Station } from './network'
import { toGround, type Ground } from './projection'

const SMALL_WORDS = new Set(['of', 'the', 'and', 'at', 'on', 'in', 'for', 'de', 'la'])
/** Vowel-less abbreviations that are words, not initials: "ST" is "St", "JFK" stays "JFK". */
const ABBREVIATIONS = new Set(['st', 'rd', 'dr', 'ln', 'ct', 'blvd', 'pkwy', 'hwy', 'expy', 'tpke', 'sq', 'plz', 'mt', 'ft'])
/** Initials with a vowel in them. */
const INITIALISMS = new Set(['nyu', 'mta', 'lirr', 'cuny', 'suny', 'usps', 'ymca', 'ywca', 'nypd', 'fdny', 'usa', 'ne', 'nw', 'se', 'sw'])

const HAS_LETTER = /\p{L}/u
const LOWERCASE = /\p{Ll}/u

function titleCase(word: string): string {
  return word.toLowerCase().replace(HAS_LETTER, (c) => c.toUpperCase())
}

/** One word with no space or hyphen in it. */
function caseWord(word: string): string {
  if (!HAS_LETTER.test(word)) return word
  if (/^\d/.test(word)) return word.toLowerCase()
  // "O'NEILL" keeps its capital after a one-letter prefix; "BARCLAY'S" doesn't.
  const [head = '', ...rest] = word.split("'")
  const tail = rest.map((piece) => (head.replace(/\P{L}/gu, '').length === 1 ? titleCase(piece) : piece.toLowerCase()))
  const letters = head.replace(/\P{L}/gu, '')
  const lower = letters.toLowerCase()
  const keepsCaps = letters.length >= 2 && !/[aeiou]/.test(lower) && !ABBREVIATIONS.has(lower)
  const first = keepsCaps || INITIALISMS.has(lower) ? head.toUpperCase() : titleCase(head)
  return [first, ...tail].join("'")
}

/**
 * Upstream GeoSearch names are all capitals ("120 BROADWAY"). A segment with any lowercase letter is left alone;
 * an all-caps one is cased word by word: small words lowercase, vowel-less initials ("JFK", "PS") and ordinals' digits kept.
 */
export function displayCase(segment: string): string {
  if (!HAS_LETTER.test(segment) || LOWERCASE.test(segment)) return segment
  return segment
    .split(' ')
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase()
      return word.split('-').map(caseWord).join('-')
    })
    .join(' ')
}

export interface PlaceText {
  name: string
  detail: string | null
  kindWord: 'Address' | 'Place'
  /** "120 Broadway, Manhattan, address": the option's accessible name. */
  spoken: string
}

export function placeText(result: GeocodeResult): PlaceText {
  const [first = '', ...rest] = result.label.split(', ')
  const name = displayCase(first)
  const detail = rest.length > 0 ? rest.map(displayCase).join(', ') : null
  const kindWord = result.kind === 'address' ? 'Address' : 'Place'
  return { name, detail, kindWord, spoken: `${detail ? `${name}, ${detail}` : name}, ${kindWord.toLowerCase()}` }
}

/** "about 250 m" (nearest 50 m, at least 50), "about 1.4 km". */
export function distanceText(m: number): string {
  const rounded = Math.max(50, Math.round(m / 50) * 50)
  if (rounded < 1000) return `about ${rounded} m`
  return `about ${(m / 1000).toFixed(1).replace(/\.0$/, '')} km`
}

/** A chosen place: where to fly, what to call it, and the station to offer. */
export interface PlacePick {
  name: string
  /** The name with its detail: "120 Broadway, Manhattan". */
  label: string
  ground: Ground
  kind: 'address' | 'place'
  nearest: NearestStation
}

/** Null for an empty network. */
export function placePick(result: GeocodeResult, text: PlaceText, stations: readonly Station[]): PlacePick | null {
  const ground = toGround({ lat: result.lat, lon: result.lon })
  const nearest = nearestStation(ground, stations)
  if (!nearest) return null
  return {
    name: text.name,
    label: text.detail ? `${text.name}, ${text.detail}` : text.name,
    ground,
    kind: text.kindWord === 'Address' ? 'address' : 'place',
    nearest,
  }
}
