/** How a searched place reads: display casing, row text, distance words, and the pick it becomes (pure). */
import type { GeocodeResult } from '../data/realtime'
import { nearestStation, type NearestStation } from './locate'
import type { Station } from './network'
import { toGround, type Ground } from './projection'
import type { StationGroup } from './stationGroups'
import type { TripPlace } from './trip'

const SMALL_WORDS = new Set(['of', 'the', 'and', 'at', 'on', 'in', 'for', 'de', 'la'])
/** Vowel-less abbreviations that are words, not initials: "ST" is "St", "JFK" stays "JFK". */
const ABBREVIATIONS = new Set(['st', 'rd', 'dr', 'ln', 'ct', 'blvd', 'pkwy', 'hwy', 'expy', 'tpke', 'sq', 'plz', 'pl', 'ctr', 'hts', 'mt', 'ft', 'apt', 'bldg', 'pk', 'brg'])
/** Initials a vowel rule can't tell from words. */
const INITIALISMS = new Set(['nyc', 'ny', 'nj', 'lga', 'jfk', 'nyu', 'att', 'cuny', 'suny', 'mta', 'lirr', 'usps', 'ymca', 'ywca', 'nypd', 'fdny', 'usa', 'bam', 'moma', 'ne', 'nw', 'se', 'sw'])
/** After an apostrophe these one-letter prefixes keep the next letter capital ("O'Neill", "D'Angelo"); others don't ("B'way"). */
const NAME_PREFIXES = new Set(['o', 'd'])

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
  const letters = head.replace(/\P{L}/gu, '')
  const lower = letters.toLowerCase()
  const tail = rest.map((piece) => (NAME_PREFIXES.has(lower) ? titleCase(piece) : piece.toLowerCase()))
  const keepsCaps = letters.length >= 2 && !/[aeiouy]/.test(lower) && !ABBREVIATIONS.has(lower)
  const first = keepsCaps || INITIALISMS.has(lower) ? head.toUpperCase() : titleCase(head)
  return [first, ...tail].join("'")
}

/**
 * Upstream GeoSearch names are all capitals ("120 BROADWAY"). A segment with any lowercase letter is left alone;
 * an all-caps one is cased word by word: small words lowercase, initials ("JFK", "AT&T", "NYU") kept, street abbreviations ("PL", "CTR") title-cased.
 */
export function displayCase(segment: string): string {
  if (!HAS_LETTER.test(segment) || LOWERCASE.test(segment)) return segment
  return segment
    .split(' ')
    .map((word, i) => {
      if (i > 0 && SMALL_WORDS.has(word.toLowerCase())) return word.toLowerCase()
      // A hyphen or slash joins separately cased parts: "WILKES-BARRE", "ATLANTIC YARDS/BARCLAY'S CENTER".
      return word.split(/([-/])/).map((part) => (part === '-' || part === '/' ? part : caseWord(part))).join('')
    })
    .join(' ')
}

export interface PlaceText {
  name: string
  detail: string | null
  kindWord: 'Address' | 'Place' | 'Street' | 'Intersection'
  /** "120 Broadway, Manhattan, address": the option's accessible name; "Bedford Av & N 7 St, Brooklyn, intersection". */
  spoken: string
}

const KIND_WORDS: Readonly<Record<GeocodeResult['kind'], PlaceText['kindWord']>> = {
  address: 'Address',
  place: 'Place',
  area: 'Place',
  street: 'Street',
  intersection: 'Intersection',
}

export function placeText(result: GeocodeResult): PlaceText {
  const [first = '', ...rest] = result.label.split(', ')
  const name = displayCase(first)
  const detail = rest.length > 0 ? rest.map(displayCase).join(', ') : null
  const kindWord = KIND_WORDS[result.kind]
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
  kind: 'address' | 'place' | 'street' | 'intersection'
  nearest: NearestStation
}

/** What a trip end's "near …" note calls the place: a street by its full label ("Broadway, Brooklyn", since "Broadway" alone is four streets), anything else by its name. */
export function nearNote(pick: Pick<PlacePick, 'kind' | 'name' | 'label'>): string {
  return pick.kind === 'street' ? pick.label : pick.name
}

/** The trip place a place pick makes of an end: the note and the place's own point, never the fix. */
export function tripPlaceOf(pick: Pick<PlacePick, 'kind' | 'name' | 'label' | 'ground'>): TripPlace {
  return { note: nearNote(pick), ground: pick.ground }
}

function pickKind(word: PlaceText['kindWord']): PlacePick['kind'] {
  return word === 'Address' ? 'address' : word === 'Street' ? 'street' : word === 'Intersection' ? 'intersection' : 'place'
}

/** Null for an empty network. */
export function placePick(
  result: GeocodeResult,
  text: PlaceText,
  stations: readonly Station[],
  groups: ReadonlyMap<string, StationGroup>,
): PlacePick | null {
  const ground = toGround({ lat: result.lat, lon: result.lon })
  const nearest = nearestStation(ground, stations, groups)
  if (!nearest) return null
  return {
    name: text.name,
    label: text.detail ? `${text.name}, ${text.detail}` : text.name,
    ground,
    kind: pickKind(text.kindWord),
    nearest,
  }
}
