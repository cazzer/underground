import type { IndexSite } from './streetIndexSchema.ts'

/** "&", "/", "@" and "+", or "and" / "at" as a word of their own. */
const SEPARATOR = /\s*[&/@+]\s*|\s+(?:and|at)\s+/

/** The two sides of "bedford av & n 7 st", split at the first separator; null when there is none or a side is empty. */
export function splitCrossing(text: string): [string, string] | null {
  const m = SEPARATOR.exec(text)
  if (m === null) return null
  const left = text.slice(0, m.index).trim()
  const right = text.slice(m.index + m[0].length).trim()
  return left === '' || right === '' ? null : [left, right]
}

const TRAILING_SEPARATOR = /\s*(?:[&/@+]|\s(?:and|at))\s*$/

/**
 * The text with a separator that has no right side yet cut off ("bedford av at" is "bedford av"), so the results do not vanish
 * while the user types the separator. Text with a right side, or no separator, comes back as it is.
 */
export function withoutTrailingSeparator(text: string): string {
  return text.replace(TRAILING_SEPARATOR, '')
}

/** Equirectangular meters; fine at city scale. */
export function approxM(a: { lat: number; lon: number }, lat: number, lon: number): number {
  const dy = (lat - a.lat) * 110_540
  const dx = (lon - a.lon) * 111_320 * Math.cos((((a.lat + lat) / 2) * Math.PI) / 180)
  return Math.hypot(dx, dy)
}

/**
 * The point a street row answers with: the site nearest the focus, else (no focus) the middle one, the site nearest the mean
 * of its sites, so a long street lands near its centre rather than at its first station.
 */
export function siteFor(sites: readonly IndexSite[], focus: { lat: number; lon: number } | null): IndexSite {
  const first = sites[0]
  if (first === undefined) throw new RangeError('a street has no site')
  const target = focus ?? {
    lat: sites.reduce((sum, s) => sum + s[0], 0) / sites.length,
    lon: sites.reduce((sum, s) => sum + s[1], 0) / sites.length,
  }
  let best = first
  let bestM = approxM(target, first[0], first[1])
  for (const s of sites) {
    const d = approxM(target, s[0], s[1])
    if (d < bestM) {
      best = s
      bestM = d
    }
  }
  return best
}
