const LABEL_MAX_CODE_POINTS = 120

/**
 * Control and format characters (bidi overrides, zero-width marks) never reach a label. Whitespace is left
 * for the collapse (a tab or newline is a word break, not nothing), so it is excluded here.
 */
export const INVISIBLE = /(?!\s)[\p{Cc}\p{Cf}]/gu

/** A label text from upstream: invisible characters removed, whitespace collapsed, capped; null when nothing is left. */
export function cleanLabel(text: string): string | null {
  const collapsed = text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  const capped = Array.from(collapsed).slice(0, LABEL_MAX_CODE_POINTS).join('').trim()
  return capped === '' ? null : capped
}

const WORDS: Readonly<Record<string, string>> = {
  street: 'st',
  avenue: 'av',
  ave: 'av',
  east: 'e',
  west: 'w',
  north: 'n',
  south: 's',
  place: 'pl',
  road: 'rd',
  boulevard: 'blvd',
  parkway: 'pkwy',
}

/**
 * A comparison key for names: case, accents, apostrophes, punctuation, ordinal suffixes and the usual
 * street abbreviations are folded away ("West 14th Street" and "W 14 ST" agree).
 */
export function nameKey(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/(\d+)(st|nd|rd|th)\b/g, '$1')
    .split(' ')
    .filter((word) => word !== '')
    .map((word) => WORDS[word] ?? word)
    .join(' ')
}

export function queryTokens(text: string): string[] {
  const key = nameKey(text)
  return key === '' ? [] : key.split(' ')
}
