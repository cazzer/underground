/** Station-name text normalization for search. Pure. */

export interface SearchToken {
  /** Lowercased, ASCII, as typed or published (after ordinals and digit/letter splits). */
  raw: string
  /** `raw` with abbreviations unified ("street" and "st" are both "st"). */
  canon: string
  numeric: boolean
  /** Written with an ordinal suffix ("14th"): that is exactly 14, not the start of 145. */
  ordinal: boolean
}

const STOP_WORDS = new Set(['and', 'the', 'of'])

const SYNONYMS: Readonly<Record<string, string>> = {
  street: 'st',
  str: 'st',
  sts: 'st',
  streets: 'st',
  saint: 'st',
  avenue: 'av',
  ave: 'av',
  aves: 'av',
  avs: 'av',
  avenues: 'av',
  square: 'sq',
  parkway: 'pkwy',
  pky: 'pkwy',
  boulevard: 'blvd',
  boul: 'blvd',
  road: 'rd',
  place: 'pl',
  heights: 'hts',
  center: 'ctr',
  centre: 'ctr',
  junction: 'jct',
  park: 'pk',
  plz: 'plaza',
  highway: 'hwy',
  turnpike: 'tpke',
  lane: 'ln',
  drive: 'dr',
  mount: 'mt',
  fort: 'ft',
  bch: 'beach',
  east: 'e',
  west: 'w',
  north: 'n',
  south: 's',
  washington: 'wash',
  bway: 'broadway',
  qns: 'queens',
}

const LONG_FORMS = new Map<string, string[]>()
for (const [form, canon] of Object.entries(SYNONYMS)) LONG_FORMS.set(canon, [...(LONG_FORMS.get(canon) ?? []), form])

/** Every spelling that maps to `canon` ("st" gives street, saint, ...), so a half-typed long form can match. */
export function longForms(canon: string): readonly string[] {
  return LONG_FORMS.get(canon) ?? []
}

/** Lowercase words of `text` with accents, punctuation and stop words removed; ordinals ("14th") become "14". */
export function searchTokens(text: string): SearchToken[] {
  const words = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bb ?way\b/g, 'broadway')
    .split(' ')
  const tokens: SearchToken[] = []
  const push = (raw: string, ordinal: boolean) => {
    if (raw === '' || STOP_WORDS.has(raw)) return
    tokens.push({ raw, canon: SYNONYMS[raw] ?? raw, numeric: /^\d+$/.test(raw), ordinal })
  }
  for (const word of words) {
    const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(word)
    if (ordinal) {
      push(ordinal[1]!, true)
      continue
    }
    for (const part of word.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').split(' ')) push(part, false)
  }
  return tokens
}

/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps each cost 1. */
export function osaDistance(a: string, b: string): number {
  const rows: number[][] = []
  for (let i = 0; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0)
    row[0] = i
    rows.push(row)
  }
  for (let j = 0; j <= b.length; j++) rows[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2]![j - 2]! + 1)
      rows[i]![j] = d
    }
  }
  return rows[a.length]![b.length]!
}
