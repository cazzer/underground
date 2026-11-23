import { loadStreetIndex, type StreetIndex } from './streetIndex.ts'

let loaded: Promise<StreetIndex> | undefined

/**
 * The bundled street index, loaded on the first /geocode miss of the isolate and kept: /rt and /ene never pay for it, and a
 * bad committed index fails /geocode (a 500 through serveGeocode's catch, no query logged) rather than the Worker's startup.
 * The JSON is a dynamic import, which wrangler's bundler inlines but evaluates on first use. Only index.ts and its data test
 * import this file: the client must never bundle it (the build is checked for a street name in dist/).
 */
export function bundledStreetIndex(): Promise<StreetIndex> {
  return (loaded ??= import('../data/streetIndex.json').then((m) => loadStreetIndex(m.default)))
}
