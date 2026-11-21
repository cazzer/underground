/** The focused station in the URL hash: `#station=<id>`. Pure. */

/** The station id in a `location.hash` value, or null when there is none. */
export function parseStationHash(hash: string): string | null {
  const id = new URLSearchParams(hash.replace(/^#/, '')).get('station')?.trim()
  return id ? id : null
}

/** The URL for `id` (or none), keeping the path and query (`?lines=`, `?debug`). */
export function stationHashUrl(location: { pathname: string; search: string }, id: string | null): string {
  return `${location.pathname}${location.search}${id === null ? '' : `#station=${encodeURIComponent(id)}`}`
}
